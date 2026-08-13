import { computed, ref, watch, onBeforeUnmount, type ComputedRef, type Ref } from "vue";
import { PILL_PEEK_DURATION_MS } from "../utils/constants.ts";
import {
  trailingItemsSignature,
  findChangedTrailingItems,
  buildPeekText,
  buildPeekSignature,
} from "../utils/pill-peek.ts";
import { peekIconForKey, peekColorForKey } from "../utils/info-pills.ts";

// アイコン群のどれかの値が更新された時、ピル群全体を隠し、変化した対象の
// アイコン + 情報テキストだけを乗せた1本の長いピル（PillPeek.vue）を
// 数秒だけ表示するための状態機械（PC・モバイル共通、PILL_PEEK_DURATION_MS）。
// 変化検出・キュー・タイマーをここに集約し、TerminalPane はpeekingKeyを
// 表示に使うだけにする。
export function usePillPeek({
  trailingPeekItems,
  paneWorkspace,
  workspaceKey,
  prsByWorkspace,
  runsByWorkspace,
  devServerEntry,
  ahead,
  behind,
  peekFields,
}: {
  trailingPeekItems: ComputedRef<{ key: string, text: string }[]>,
  paneWorkspace: ComputedRef<Record<string, any> | undefined>,
  workspaceKey: () => string | null | undefined,
  prsByWorkspace: Ref<Record<string, any[]>>,
  runsByWorkspace: Ref<Record<string, any[]>>,
  devServerEntry: ComputedRef<Record<string, any> | null>,
  ahead: Ref<number>,
  behind: Ref<number>,
  peekFields: ComputedRef<Record<string, any>>,
}) {
  const peekingKey = ref<string | null>(null);
  // このpeekが実際に表示される時間（キューで分割された場合はPILL_PEEK_DURATION_MS
  // より短くなる）。PillPeek.vueがマーキーの再生時間をこれに合わせるため。
  const peekDurationMs = ref(PILL_PEEK_DURATION_MS);
  let prevTrailingSignature = trailingItemsSignature(trailingPeekItems.value);
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  // branchのpeekで矢印（ahead/behind）が消えた瞬間、ブランチ名の横に
  // 「Pushed (N)」「Pulled (N)」を出す（下記 watch(trailingPeekItems, ...) 内で設定）。
  // 0は非表示、直前のahead/behind値＝実際に押し出された/取り込まれた件数。
  const branchPushCount = ref(0);
  const branchPullCount = ref(0);
  // paneWorkspace は workspaceStore.allWorkspaces（非同期フェッチ）に依存するため、
  // マウント直後は未解決（undefined）で isGitRepo 等が一時的に false になり得る。
  // このタイミングで prevTrailingSignature を確定させると、ワークスペース情報が
  // 届いた瞬間に「branch が新規に現れた」と誤検知して、畳んだ状態でも
  // Branches ボタンが一瞬 peek 表示されてしまう。ワークスペースが一度でも
  // 解決するまでは変化検出を行わず、解決した最初の1回はベースラインの
  // 更新だけ行って peek はスキップする。
  let workspaceEverResolved = paneWorkspace.value !== undefined;
  // last_commit_message は paneWorkspace 自体が解決した後もさらに遅れて
  // 非同期ロードされる（workspaceStore のステータス取得参照）。
  // これを "history" の変化検出にそのまま使うと、通常のロード完了時にも
  // 「新しくコミットされた」と誤検知してpeekが発火してしまうため、
  // 初めて値が解決した1回だけベースラインを更新して変化扱いにしない。
  let historyMessageEverResolved = paneWorkspace.value?.last_commit_message !== undefined;
  // PR一覧もfetchPRsによる非同期取得のため、初回のロード完了を
  // 「新しくPRが作られた」と誤検知しないよう同様のガードをかける。
  function prsResolvedFor(workspace: string | null | undefined) {
    return !!workspace && prsByWorkspace.value[workspace] !== undefined;
  }
  let prsEverResolved = prsResolvedFor(workspaceKey());
  // GitHub Actionsのrun一覧も同様に非同期取得のため、同じガードをかける。
  function actionsResolvedFor(workspace: string | null | undefined) {
    return !!workspace && runsByWorkspace.value[workspace] !== undefined;
  }
  let actionsEverResolved = actionsResolvedFor(workspaceKey());

  // ほぼ同時に複数のピルが変化した場合、後の変化が前の変化のpeek表示を
  // 即座に上書きしてしまわないよう、表示中でなければ即座に、表示中なら
  // キューに積んで前のpeekが閉じてから順番に表示する。表示時間は1件ずつ
  // PILL_PEEK_DURATION_MSではなく、キュー全体（このセッション開始から）
  // の合計がPILL_PEEK_DURATION_MSに収まるよう残り時間を残件数で割る。
  const peekQueue: { key: string, pushCount: number, pullCount: number }[] = [];
  let queueSessionEndsAt = 0;

  function advancePeekQueue() {
    const next = peekQueue.shift();
    if (!next) {
      peekingKey.value = null;
      peekTimer = null;
      return;
    }
    peekingKey.value = next.key;
    branchPushCount.value = next.pushCount || 0;
    branchPullCount.value = next.pullCount || 0;
    const remainingMs = Math.max(0, queueSessionEndsAt - Date.now());
    const itemMs = Math.max(1, Math.round(remainingMs / (peekQueue.length + 1)));
    peekDurationMs.value = itemMs;
    peekTimer = setTimeout(advancePeekQueue, itemMs);
  }

  function triggerPeek(key: string, pushCount = 0, pullCount = 0) {
    peekQueue.push({ key, pushCount, pullCount });
    if (!peekTimer) {
      queueSessionEndsAt = Date.now() + PILL_PEEK_DURATION_MS;
      advancePeekQueue();
    }
  }

  // 初回解決キーのベースラインを次シグネチャの値へ揃える（変化扱いにしない）。
  // 次シグネチャにキーが無い場合はdeleteする（Map.getはどちらもundefinedを
  // 返すため、undefinedをsetするのと変化判定上は等価）。
  function carryBaseline(key: string, nextSignature: Map<string, string>) {
    const value = nextSignature.get(key);
    if (value === undefined) prevTrailingSignature.delete(key);
    else prevTrailingSignature.set(key, value);
  }

  watch(trailingPeekItems, (items) => {
    const nextSignature = trailingItemsSignature(items);
    const historyJustResolved = !historyMessageEverResolved && paneWorkspace.value?.last_commit_message !== undefined;
    if (historyJustResolved) {
      historyMessageEverResolved = true;
      carryBaseline("history", nextSignature);
    }
    const prsJustResolved = !prsEverResolved && prsResolvedFor(workspaceKey());
    if (prsJustResolved) {
      prsEverResolved = true;
      carryBaseline("prs", nextSignature);
    }
    const actionsJustResolved = !actionsEverResolved && actionsResolvedFor(workspaceKey());
    if (actionsJustResolved) {
      actionsEverResolved = true;
      carryBaseline("actions", nextSignature);
    }
    const justResolved = !workspaceEverResolved && paneWorkspace.value !== undefined;
    if (justResolved) workspaceEverResolved = true;
    if (workspaceEverResolved && !justResolved) {
      for (const changed of findChangedTrailingItems(items, prevTrailingSignature)) {
        let pushCount = 0;
        let pullCount = 0;
        if (changed.key === "branch") {
          // 直前のシグネチャ（branch:ahead:behind）と比べ、ahead/behindが
          // >0 から 0 へ変わった＝push/pullが完了した瞬間。直前の値が
          // そのまま実際に送信/取得されたコミット数になる。
          const [, prevAheadStr, prevBehindStr] = (prevTrailingSignature.get("branch") || "").split(":");
          const prevAhead = Number(prevAheadStr) || 0;
          const prevBehind = Number(prevBehindStr) || 0;
          if (prevAhead > 0 && ahead.value === 0) pushCount = prevAhead;
          if (prevBehind > 0 && behind.value === 0) pullCount = prevBehind;
        }
        triggerPeek(changed.key, pushCount, pullCount);
      }
    }
    prevTrailingSignature = nextSignature;
  }, { deep: true });

  // Dev Serverが検出されなくなった（実際に停止した）瞬間だけ知らせる。
  // trailingPeekItemsはdevServerEntryが無い間キー自体を積まないため、
  // 上のfindChangedTrailingItemsでは「消えたこと」を検知できない
  // （新規出現/値変化しか拾えない）。devServerEntry自体を直接見て、
  // 真→偽への遷移だけを拾う（初回のnullや既に偽のままの変化は無視）。
  watch(devServerEntry, (entry, prevEntry) => {
    if (!entry && prevEntry) triggerPeek("devserver-stop");
  });

  onBeforeUnmount(() => {
    if (peekTimer) {
      clearTimeout(peekTimer);
      peekTimer = null;
    }
    peekQueue.length = 0;
  });

  // peekピルの表示に使う派生値もここで返す（TerminalPane / SessionSidebarRow で
  // 同じ組み立てを繰り返さないため）。アイコン・色はキーごとの静的テーブル
  // （info-pills.ts）、テキスト・シグネチャはpill-peek.tsの純粋関数。
  const peekIconClass = computed(() => peekIconForKey(peekingKey.value));
  const peekColorClass = computed(() => peekColorForKey(peekingKey.value, peekFields.value));
  const peekText = computed(() => buildPeekText(peekingKey.value, peekFields.value));
  const peekSignature = computed(() => buildPeekSignature(peekingKey.value, peekFields.value));
  // actionsは名前部分（白固定）とステータス部分（実行中/失敗で色分け）を
  // 別spanに分けて表示するため、PillPeek.vueへ個別に渡す（branchName/ahead/
  // behind等と同じ扱い）。
  const peekActionName = computed(() => peekFields.value?.branchAction?.name || "");
  const peekActionStatusText = computed(() => {
    const run = peekFields.value?.branchAction;
    return run ? (run.conclusion || run.status) : "";
  });

  return {
    peekingKey,
    peekDurationMs,
    branchPushCount,
    branchPullCount,
    peekIconClass,
    peekColorClass,
    peekText,
    peekSignature,
    peekActionName,
    peekActionStatusText,
  };
}
