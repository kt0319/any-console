<template>
  <div class="modal-scroll-body">
    <div class="dispatch-run-header">
      <button type="button" class="dispatch-run-back-btn" aria-label="Back to dispatch list" data-tooltip="Back" @click="emits('back')">
        <span class="mdi mdi-arrow-left"></span>
      </button>
      <span class="dispatch-run-title">{{ isRerun ? "Rerun Dispatch" : "Run Dispatch" }}</span>
    </div>
    <div v-if="request" class="ws-settings-section">
      <div class="ws-settings-row">
        <span class="ws-settings-label">Session</span>
        <select v-model="selectedSessionId" class="form-input">
          <option :value="NEW_SESSION_VALUE">+ New session</option>
          <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
            {{ s.workspace ? `${s.workspace} / ${s.job_label || s.job_name || 'Terminal'}` : (s.job_label || s.job_name || 'Terminal') }}
          </option>
        </select>
      </div>

      <!-- Workspace / Job: 新規セッション時のみ有効（既存セッション選択時は参考表示のみ） -->
      <div class="ws-settings-row">
        <span class="ws-settings-label">Workspace</span>
        <select v-model="selectedWorkspace" class="form-input" :disabled="!isNewSession">
          <option v-for="w in workspaceOptions" :key="w.name" :value="w.name">{{ w.name }}</option>
        </select>
      </div>
      <dl v-if="showWorktreeInfo" class="dispatch-run-meta">
        <dt>Worktree</dt>
        <dd>{{ request.worktree }}</dd>
      </dl>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Job</span>
        <select v-model="selectedJob" class="form-input" :disabled="!isNewSession">
          <option value="terminal">Terminal</option>
          <option v-for="job in jobs" :key="job.key" :value="job.key">
            {{ job.label }}
          </option>
        </select>
      </div>

      <template v-if="hasBranchField">
        <div class="ws-settings-row" style="gap:8px">
          <label class="form-check-label"><input type="radio" v-model="createMode" value="" /> Change branch</label>
          <label class="form-check-label"><input type="radio" v-model="createMode" value="branch" /> Create branch</label>
          <label class="form-check-label"><input type="radio" v-model="createMode" value="worktree" /> Create worktree</label>
        </div>
        <div v-if="createMode" class="ws-settings-row">
          <span class="ws-settings-label">New branch</span>
          <input
            v-model="branch"
            type="text"
            class="form-input"
            placeholder="New branch name"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">{{ createMode ? "Base branch" : "Branch" }}</span>
          <select v-model="branchSelectValue" class="form-input">
            <option value="">(current branch)</option>
            <option v-for="b in localBranches" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
      </template>

      <div class="ws-settings-row ws-settings-row-stack">
        <span class="ws-settings-label">Input</span>
        <textarea v-model="text" class="form-input dispatch-run-input" rows="4" autocomplete="off" spellcheck="false"></textarea>
      </div>

      <div v-if="missingBranchBlockReason" class="job-config-error">{{ missingBranchBlockReason }}</div>
      <div v-if="dirtyBlockReason" class="job-config-error">{{ dirtyBlockReason }}</div>

      <div class="ws-settings-row" style="gap:8px">
        <button
          type="button"
          class="primary"
          :disabled="running || !!dirtyBlockReason || !!missingBranchBlockReason || (selectedCreateWorktree && !branch.trim())"
          @click="run"
        >
          <span class="mdi mdi-play"></span> {{ running ? "Running..." : "Run" }}
        </button>
      </div>
      <div v-if="runError" class="job-config-error">{{ runError }}</div>
    </div>

    <!-- 実行済み（Rerun）には破棄する承認待ちが無いため Discard は出さない -->
    <div v-if="request && !isRerun" class="ws-settings-section ws-delete-section">
      <button type="button" class="ws-delete-btn" :disabled="discarding" @click="discard">
        <span class="mdi mdi-close"></span>
        {{ discarding ? "Discarding..." : "Discard dispatch" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useApi } from "../composables/useApi.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useDispatchQueue } from "../composables/useDispatchQueue.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { EP_TERMINAL_SESSIONS } from "../utils/endpoints.ts";
import { on } from "../app-bridge.ts";

// Session select の「新規セッション」を表す特別値。
const NEW_SESSION_VALUE = "__new_session__";

// ワークスペース詳細のDispatchタブ内で、一覧（DispatchWorkspacePane）から
// 選ばれた1件を表示するローカルな画面遷移として使う（WorkspaceDetail.vueが
// activePane === 'dispatch' の中でv-ifを切り替える）。Settings側のpushView
// スタックには乗せない（サイドバー側に別レイヤーとして出てしまっていたため）。
const props = defineProps({
  itemId: { type: String, required: true },
});
const emits = defineEmits(["back", "done"]);

const { apiGet, apiCommand, wsEndpoint } = useApi();
const { confirm } = useConfirm();
const { queue, recent, runItem, rejectItem } = useDispatchQueue();
const workspaceStore = useWorkspaceStore();

const itemId = props.itemId;
// 承認待ち（queue）を優先し、無ければ実行済み履歴（recent）から探す。
// recent 由来の場合は「編集して再実行」モード（isRerun）になる:
// Run は承認キューを経由せずその場で再実行し、Discard（承認待ちの破棄）は
// 対象が無いため出さない。
const queueItem = computed(() => queue.value.find((q) => q.id === itemId) || null);
const recentItem = computed(() => queueItem.value ? null : (recent.value.find((r) => r.id === itemId) || null));
const item = computed(() => queueItem.value || recentItem.value);
const request = computed(() => item.value?.request || null);
const isRerun = computed(() => !queueItem.value && !!recentItem.value);

const branch = ref("");
const baseBranch = ref("");
const text = ref("");
const selectedWorkspace = ref("");
const selectedJob = ref("terminal");
const selectedSessionId = ref(NEW_SESSION_VALUE);
// "" | "branch" | "worktree"。ラジオボタンで排他選択する（worktree は新規ブランチ前提のため
// Create branch と両立しない）。
const createMode = ref("");
const selectedCreateBranch = computed(() => createMode.value === "branch");
const selectedCreateWorktree = computed(() => createMode.value === "worktree");
const isNewSession = computed(() => selectedSessionId.value === NEW_SESSION_VALUE);

// Branch select は Create branch/worktree の on/off で意味が変わる（対象ブランチ or 分岐元ブランチ）ため、
// 書き込み先を切り替える get/set computed で1つの select 要素を共用する。
const branchSelectValue = computed({
  get: () => (selectedCreateBranch.value || selectedCreateWorktree.value ? baseBranch.value : branch.value),
  set: (val) => {
    if (selectedCreateBranch.value || selectedCreateWorktree.value) baseBranch.value = val;
    else branch.value = val;
  },
});

const jobs = ref<{ key: string, label: string }[]>([]);
const sessions = ref<Record<string, any>[]>([]);
const localBranches = ref<string[]>([]);
const localBranchesLoaded = ref(false);
const running = ref(false);
const discarding = ref(false);
const runError = ref("");

function initFromRequest(req: Record<string, any> | null) {
  branch.value = req?.branch || "";
  baseBranch.value = req?.base_branch || "";
  text.value = req?.text || "";
  selectedWorkspace.value = req?.workspace || "";
  selectedJob.value = req?.job || "terminal";
  selectedSessionId.value = req?.existing_session_id || NEW_SESSION_VALUE;
  createMode.value = req?.create_branch ? "branch" : "";
}

// 新規セッション作成時はworktreeをドロップダウンの選択肢に含めない
// （ベースワークスペースのみ選択可能。worktree自体はCreate worktreeで別途作る）。
// 既存セッションを選んだ時（disabledの参考表示）は、そのセッションのworkspaceが
// worktreeのこともあるため、一覧に無いと選択値と選択肢がズレて空欄に見えて
// しまう。選択中の値が一覧に無ければ表示専用として追加する。
const workspaceOptions = computed(() => {
  const opts = workspaceStore.allWorkspaces.filter((w) => !w.worktree);
  if (!isNewSession.value && selectedWorkspace.value && !opts.some((w) => w.name === selectedWorkspace.value)) {
    const current = workspaceStore.allWorkspaces.find((w) => w.name === selectedWorkspace.value);
    if (current) opts.push(current);
  }
  return opts;
});
const showWorktreeInfo = computed(() => !!request.value?.worktree && selectedWorkspace.value === request.value?.workspace);

// worktree 上の dispatch はブランチが既に固定されているため、ブランチ操作の
// 項目自体を出さない。それ以外は常に表示し、Create branch のチェック有無で
// Branch select の意味（対象 / 分岐元）と Branch name の表示を切り替える。
const hasBranchField = computed(() => !request.value?.worktree);

// Change branch の select は localBranches（実在するブランチ）と「(current branch)」
// しか選択肢が無いため、ユーザー操作では不正な値にならない。ズレが起き得るのは
// 外部（CI等）から渡された元リクエストの branch が実在しない初期値のときだけ
// （select 上は "(current branch)" のように見えて、実際の値はそのままズレている）。
// これに気付かず Run すると失敗するので、送信前に検知して disable する。
const missingBranchBlockReason = computed(() => {
  if (createMode.value !== "") return "";
  if (!localBranchesLoaded.value) return ""; // 一覧取得が未完了/失敗の間は判定しない（fail open）
  const target = branch.value.trim();
  if (!target || localBranches.value.includes(target)) return "";
  return `Branch "${target}" does not exist in this workspace.`;
});

// サーバ側のガード（api/routers/dispatch.py の _ensure_branch）と対になる UI 側の
// 事前ブロック。新規ブランチを作成する dispatch（Create branch オン）は対象
// ワークスペースが dirty だと 400 で失敗するため、送信前に理由を示して Run を
// disable する。既存ブランチへの checkout（Create branch オフ）は対象外（サーバ
// 側も dirty かどうかに関わらず同じ扱いだが、ここでは新規ブランチ作成時のみブロック
// する方針）。
// changed_files は untracked ファイル込みでカウントされる（api/git_info.py）ため、
// ここでの dirty 判定も同じ基準（gitignore されていない未追跡ファイルがあれば
// 安全側でブロックする）に揃える。
const targetWorkspaceEntry = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === selectedWorkspace.value),
);
const isSwitchingBranch = computed(() => {
  if (!hasBranchField.value || !selectedCreateBranch.value) return false;
  const target = branch.value.trim();
  if (!target) return false;
  const current = targetWorkspaceEntry.value?.branch || "";
  return target !== current;
});
const workspaceChangedFiles = computed(() => targetWorkspaceEntry.value?.changed_files || 0);
const dirtyBlockReason = computed(() => {
  if (!isSwitchingBranch.value || workspaceChangedFiles.value <= 0) return "";
  const n = workspaceChangedFiles.value;
  return `Workspace has uncommitted changes (${n} file${n === 1 ? "" : "s"}). Commit or stash them, or clear the branch to run on the current branch.`;
});

// dedup_key による置き換えは通知リンクを有効に保つため dispatch_id を維持する
// （useDispatchQueue.ts 参照）。そのため置き換えられても dispatch:itemRemoved
// は発火しない。retry_count の変化で「表示中の内容が別の失敗に置き換わった」
// ことを検知し、フォームを黙って差し替えるのではなくダイアログを閉じる
// （古い branch/text のまま承認され、置き換わった内容と食い違って実行される
// 事故を防ぐため）。
const initialRetryCount = ref<number | null>(null);

onMounted(() => {
  if (!item.value) { emits("back"); return; }
  initFromRequest(request.value);
  initialRetryCount.value = request.value?.retry_count ?? 1;
});

const offItemRemoved = on("dispatch:itemRemoved", ({ id }) => {
  if (id === itemId) emits("back");
});
onUnmounted(offItemRemoved);

watch(() => request.value?.retry_count, (count) => {
  if (initialRetryCount.value !== null && count !== undefined && count !== initialRetryCount.value) {
    emits("back");
  }
});

// セッション一覧はSession selectの選択肢そのものなので、選択操作のたびに
// 取り直す必要はなくマウント時に1回だけ取得すれば足りる。
onMounted(() => {
  apiGet(EP_TERMINAL_SESSIONS).then((res) => {
    if (res.ok && Array.isArray(res.data)) sessions.value = res.data.filter((s) => !s.detached);
  });
});

// 既存セッションを選んだら、そのセッションの実際の Workspace / Job を
// プレビュー表示に反映する（disabled のままだが選択中セッションに追従させる）。
// 新規セッションに戻したら元のリクエスト値に戻す。
watch(selectedSessionId, (id) => {
  if (id === NEW_SESSION_VALUE) {
    selectedWorkspace.value = request.value?.workspace || "";
    selectedJob.value = request.value?.job || "terminal";
    return;
  }
  const s = sessions.value.find((s) => s.session_id === id);
  if (!s) return;
  selectedWorkspace.value = s.workspace || selectedWorkspace.value;
  selectedJob.value = s.job_name || "terminal";
});

watch(selectedWorkspace, async (ws) => {
  jobs.value = [];
  if (!ws) return;
  const res = await apiGet(wsEndpoint(ws, "jobs"));
  if (res.ok && res.data) {
    jobs.value = Object.entries(res.data as Record<string, any>).map(([key, def]) => ({ key, label: def.label || key }));
  }
  if (selectedJob.value !== "terminal" && !jobs.value.some((j) => j.key === selectedJob.value)) {
    selectedJob.value = "terminal";
  }
}, { immediate: true });

// Base branch のブランチ一覧: 選択中セッションのワークスペースまたは選択中のワークスペース
const baseBranchWorkspace = computed(() => {
  if (!isNewSession.value && selectedSessionId.value) {
    const s = sessions.value.find((s) => s.session_id === selectedSessionId.value);
    return s?.workspace || request.value?.workspace;
  }
  return selectedWorkspace.value;
});

watch(baseBranchWorkspace, async (ws) => {
  localBranches.value = [];
  localBranchesLoaded.value = false;
  if (!ws) return;
  const res = await apiGet(wsEndpoint(ws, "branches"));
  if (res.ok && Array.isArray(res.data)) {
    // 現在ブランチを一覧の先頭に出す（"(current branch)" プレースホルダーとは別に、
    // 実ブランチ名の並びの中でも現在ブランチがどこにあるか分かりやすくするため）。
    const current = res.data.find((b) => b.current);
    const rest = res.data.filter((b) => !b.current).map((b) => b.name);
    localBranches.value = current ? [current.name, ...rest] : rest;
    localBranchesLoaded.value = true;
  }
  if (baseBranch.value && !localBranches.value.includes(baseBranch.value)) {
    baseBranch.value = "";
  }
}, { immediate: true });

function buildOverrides() {
  const orig = request.value || {};
  const origIsNew = !orig.existing_session_id;
  const origCreateBranch = !!orig.create_branch;
  return {
    workspace: selectedWorkspace.value !== (orig.workspace || "") ? selectedWorkspace.value : null,
    branch: branch.value !== (orig.branch || "") ? branch.value : null,
    base_branch: baseBranch.value !== (orig.base_branch || "") ? baseBranch.value : null,
    text: text.value !== (orig.text || "") ? text.value : null,
    job: selectedJob.value !== (orig.job || "terminal") ? selectedJob.value : null,
    match: isNewSession.value !== origIsNew ? (isNewSession.value ? "none" : "any") : null,
    session_id: !isNewSession.value && selectedSessionId.value !== (orig.existing_session_id || null) ? selectedSessionId.value : null,
    create_branch: selectedCreateBranch.value !== origCreateBranch ? selectedCreateBranch.value : null,
  };
}

async function run() {
  if (running.value || !itemId) return;
  running.value = true;
  runError.value = "";
  try {
    const overrides = buildOverrides();
    if (selectedCreateWorktree.value) {
      // worktree は既存の GitChangeBranch.vue の Add > Worktree と同じ API で先に作成し、
      // 作成後の compound な workspace 名（"{base}:{branch}"）をそのまま dispatch の
      // workspace として使う（dispatch.py 側の worktree フィールドは既存 worktree の
      // 検索専用で新規作成はしないため、作成自体はここで済ませる）。
      const { ok, data } = await apiCommand(
        wsEndpoint(selectedWorkspace.value, "worktrees"),
        { branch: branch.value.trim(), base: baseBranch.value || null },
        { errorMessage: "Failed to create worktree" },
      );
      if (!ok) return;
      const createdName = data?.workspace?.name;
      if (!createdName) return;
      await workspaceStore.fetchWorkspaces();
      overrides.workspace = createdName;
      overrides.branch = null;
      overrides.base_branch = null;
      overrides.create_branch = null;
      // worktree自体の作成に成功した時点でモーダルを閉じる。以降のdispatch実行
      // （新規セッション起動＋Input欄の送信）は結果を待たずバックグラウンドで
      // 継続する（作成〜実行の2段階の完了待ちでモーダルが開いたままになるのを
      // 避けるため）。実行自体が失敗した場合はrunItem内のapiPostが通常の
      // エラートースト（errorMessage）で通知する。
      emits("done");
      runItem(itemId, overrides).catch(() => {});
      return;
    }
    const ok = await runItem(itemId, overrides);
    // Run 成功後はそのままセッションを見せたいので、一覧へ戻さずワークスペース
    // 詳細ごと閉じる（emits("done")、WorkspaceDetail.vue参照）。
    if (ok) emits("done");
  } finally {
    running.value = false;
  }
}

async function discard() {
  if (discarding.value || !itemId) return;
  const label = request.value?.effective_workspace || request.value?.workspace || "";
  if (!await confirm(`Discard dispatch for "${label}"? This cannot be undone.`)) return;
  discarding.value = true;
  try {
    const ok = await rejectItem(itemId);
    if (ok) emits("back");
  } finally {
    discarding.value = false;
  }
}
</script>

<style scoped>
/* ワークスペース詳細のDispatchタブ内での一覧への戻り導線
   （GitHistory.vueのdiff-files-close-btnと同じ見た目のパターン）。 */
.dispatch-run-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 8px;
}

.dispatch-run-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-primary);
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-run-back-btn:hover {
    background: var(--bg-tertiary);
  }
}

.dispatch-run-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

/* "Base branch" 等の長いラベルに合わせて列幅を揃える（Session/Workspace/Job と同じ開始位置にする）。 */
.ws-settings-label {
  min-width: 84px;
}

.ws-settings-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.ws-settings-row-stack .ws-settings-label {
  min-width: 0;
}

.ws-delete-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.ws-delete-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  font-size: 13px;
  color: var(--error);
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  cursor: pointer;
  justify-content: center;
}

.dispatch-run-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 13px;
  padding: 0 4px;
}
.dispatch-run-meta dt {
  color: var(--text-secondary);
}
.dispatch-run-meta dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
}
.dispatch-run-note {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.dispatch-run-input {
  resize: vertical;
  font-family: monospace;
}
</style>
