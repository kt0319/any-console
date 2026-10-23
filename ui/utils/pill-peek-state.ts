// usePillPeek の判定ロジック（変化検出・Dev Server停止の保留・キューの表示時間）。
// Vue・タイマー・現在時刻・バスに依存せず、状態と入力から次の状態と実行すべき処理を返す。

import { PILL_PEEK_DURATION_MS, PILL_PEEK_REMOTE_DURATION_MS, PILL_PEEK_REMOTE_DEDUP_MS } from "./constants.ts";
import type { RemoteResult } from "./git-remote.ts";
import { trailingItemsSignature, findChangedTrailingItems, mergeVanishedTrailingKeys } from "./pill-peek.ts";

type TrailingItem = { key: string; text: string };

export interface TrailingPeekState {
  signature: Map<string, string>;
  itemKeys: Set<string>;
  workspace: string | null | undefined;
  upstreamHead: string | undefined;
  workspaceEverResolved: boolean;
  prsEverResolved: boolean;
  actionsEverResolved: boolean;
}

export interface TrailingPeekInput {
  items: TrailingItem[];
  workspace: string | null | undefined;
  workspaceResolved: boolean;
  prsResolved: boolean;
  actionsResolved: boolean;
  branch: string | undefined;
  ahead: number;
  behind: number;
  upstreamHead: string | undefined;
  // 完了済みの現在ブランチのrun。同じrunを二重にpeekしないための claim を呼び出し側が行う。
  completedActionRun: { id: string | number } | null;
  // 件名を取得して「N Pushed/Pulled」に添えられるか（取得関数があり、ワークスペースが決まっている）。
  canFetchSubjects: boolean;
  now: number;
  lastRemoteResultAt: number;
  resyncing: boolean;
}

export type TrailingPeekEffect =
  | { type: "peek"; key: string; pushCount: number; pullCount: number; claimRunId?: string | number }
  | { type: "branchSubjectPeek"; kind: "push" | "pull"; total: number };

export function createTrailingPeekState(init: {
  items: TrailingItem[];
  workspace: string | null | undefined;
  upstreamHead: string | undefined;
  workspaceResolved: boolean;
  prsResolved: boolean;
  actionsResolved: boolean;
}): TrailingPeekState {
  const signature = trailingItemsSignature(init.items);
  return {
    signature,
    itemKeys: new Set(signature.keys()),
    workspace: init.workspace,
    upstreamHead: init.upstreamHead,
    workspaceEverResolved: init.workspaceResolved,
    prsEverResolved: init.prsResolved,
    actionsEverResolved: init.actionsResolved,
  };
}

function carryBaseline(signature: Map<string, string>, key: string, nextSignature: Map<string, string>) {
  const value = nextSignature.get(key);
  if (value === undefined) signature.delete(key);
  else signature.set(key, value);
}

// branchの前回シグネチャ（branch:ahead:behind）から、ahead/behindが>0から0へ落ちた件数を求める。
// ブランチ名が変わっている場合はブランチ切替でありpush/pull完了ではないため対象外。
// pushはupstreamを動かす（force pushも同じ）。resetはローカルだけを動かすので、upstreamが
// 動いていなければ「Pushed」にしない。
function detectRemoteCounts(prevBranchSignature: string, input: TrailingPeekInput, upstreamMoved: boolean) {
  const [prevBranch, prevAheadStr, prevBehindStr] = prevBranchSignature.split(":");
  const prevAhead = Number(prevAheadStr) || 0;
  const prevBehind = Number(prevBehindStr) || 0;
  let pushCount = 0;
  let pullCount = 0;
  if (prevBranch === input.branch) {
    if (prevAhead > 0 && input.ahead === 0 && upstreamMoved) pushCount = prevAhead;
    if (prevBehind > 0 && input.behind === 0) pullCount = prevBehind;
  }
  return { pushCount, pullCount };
}

export function reduceTrailingPeek(
  state: TrailingPeekState,
  input: TrailingPeekInput,
): { state: TrailingPeekState; effects: TrailingPeekEffect[] } {
  const nextSignature = trailingItemsSignature(input.items);
  const signature = new Map(state.signature);
  let { workspace, workspaceEverResolved, prsEverResolved, actionsEverResolved } = state;

  // ワークスペースが変わったら、消えたキー用に残していた前の値は別ワークスペースのものなので捨てる。
  if (input.workspace !== workspace) {
    workspace = input.workspace;
    for (const key of [...signature.keys()]) {
      if (!state.itemKeys.has(key)) signature.delete(key);
    }
  }
  if (!prsEverResolved && input.prsResolved) {
    prsEverResolved = true;
    carryBaseline(signature, "prs", nextSignature);
  }
  if (!actionsEverResolved && input.actionsResolved) {
    actionsEverResolved = true;
    carryBaseline(signature, "actions", nextSignature);
  }
  const justResolved = !workspaceEverResolved && input.workspaceResolved;
  if (justResolved) workspaceEverResolved = true;

  const effects: TrailingPeekEffect[] = [];
  if (workspaceEverResolved && !justResolved) {
    const upstreamMoved = state.upstreamHead !== input.upstreamHead;
    for (const changed of findChangedTrailingItems(input.items, signature)) {
      let pushCount = 0;
      let pullCount = 0;
      if (changed.key === "branch") {
        ({ pushCount, pullCount } = detectRemoteCounts(signature.get("branch") || "", input, upstreamMoved));
      }
      // 直前にgit:remoteDoneで同じ結果を出している時は、ahead/behindが0に落ちたことの
      // 検出による「N Pushed/Pulled」を重ねて出さない。
      const coveredByRemoteResult = (pushCount > 0 || pullCount > 0)
        && input.now - input.lastRemoteResultAt < PILL_PEEK_REMOTE_DEDUP_MS;
      if (coveredByRemoteResult) continue;
      const exactlyOneDirection = (pushCount > 0) !== (pullCount > 0);
      if (changed.key === "branch" && exactlyOneDirection && input.canFetchSubjects) {
        effects.push({ type: "branchSubjectPeek", kind: pushCount > 0 ? "push" : "pull", total: pushCount || pullCount });
        continue;
      }
      const effect: TrailingPeekEffect = { type: "peek", key: changed.key, pushCount, pullCount };
      if (changed.key === "actions" && input.completedActionRun) effect.claimRunId = input.completedActionRun.id;
      effects.push(effect);
    }
  }

  const mergedSignature = mergeVanishedTrailingKeys(signature, nextSignature, state.itemKeys, input.resyncing);
  // branchの前の値を残している間は、push判定用のupstream_headも動かさない。
  const upstreamHead = nextSignature.has("branch") || !mergedSignature.has("branch") ? input.upstreamHead : state.upstreamHead;
  return {
    state: {
      signature: mergedSignature,
      itemKeys: new Set(nextSignature.keys()),
      workspace,
      upstreamHead,
      workspaceEverResolved,
      prsEverResolved,
      actionsEverResolved,
    },
    effects,
  };
}

export type DevServerStopEvent =
  | { type: "entryChanged"; present: boolean; hadPrevious: boolean; settled: boolean }
  | { type: "settledChanged"; settled: boolean; present: boolean };

// Dev Serverが消えた瞬間だけ知らせる。再同期前に消えた場合は保留し、同期後も無ければ1回だけ出す。
export function reduceDevServerStop(pending: boolean, event: DevServerStopEvent): { pending: boolean; fire: boolean } {
  if (event.type === "entryChanged") {
    if (event.present) return { pending: false, fire: false };
    if (!event.hadPrevious) return { pending, fire: false };
    if (event.settled) return { pending, fire: true };
    return { pending: true, fire: false };
  }
  if (!event.settled) return { pending, fire: false };
  return { pending: false, fire: pending && !event.present };
}

export interface PeekQueueItem {
  key: string;
  pushCount: number;
  pullCount: number;
  remote: RemoteResult | null;
  guaranteed: boolean;
  text: string;
}

export function startPeekSession(remote: RemoteResult | null, now: number): number {
  return now + (remote ? PILL_PEEK_REMOTE_DURATION_MS : PILL_PEEK_DURATION_MS);
}

// キュー全体の合計がPILL_PEEK_DURATION_MSに収まるよう残り時間を残件数で割る。ただしpull/pushの結果・
// ワークスペース/ジョブの検知は、先行peekで残り時間を使い切られていても一定時間は必ず表示する。
export function advancePeekQueue(
  queue: readonly PeekQueueItem[],
  sessionEndsAt: number,
  now: number,
): { item: PeekQueueItem | null; queue: PeekQueueItem[]; itemMs: number; nextSessionEndsAt: number } {
  const [item, ...rest] = queue;
  if (!item) return { item: null, queue: [], itemMs: 0, nextSessionEndsAt: sessionEndsAt };
  const remainingMs = Math.max(0, sessionEndsAt - now);
  const sharedMs = Math.max(1, Math.round(remainingMs / (rest.length + 1)));
  const guaranteedMs = item.remote ? PILL_PEEK_REMOTE_DURATION_MS : item.guaranteed ? PILL_PEEK_DURATION_MS : 0;
  const itemMs = guaranteedMs ? Math.max(sharedMs, guaranteedMs) : sharedMs;
  const nextSessionEndsAt = guaranteedMs ? Math.max(sessionEndsAt, now + itemMs) : sessionEndsAt;
  return { item, queue: rest, itemMs, nextSessionEndsAt };
}
