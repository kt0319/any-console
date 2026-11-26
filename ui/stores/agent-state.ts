import { defineStore } from "pinia";
import { reactive } from "vue";
import { WORKING_MIN_DURATION_MS } from "../utils/constants.ts";

/**
 * セッション単位のエージェント状態と「見たら消える」通知バッジ。
 * キーはタブIDではなくsessionIdで、タブの開閉とは独立したライフサイクルを持つ。
 */
export const useAgentStateStore = defineStore("agent-state", () => {
  // sessionId → エージェント状態（backendはblocked/working/idleのみ）。
  const agentStates = reactive<Record<string, string>>({});
  // sessionId → 判定元（"hook"/"manifest"/"screen"、デバッグ表示専用）。
  const agentStateSources = reactive<Record<string, string>>({});
  // sessionId → working→idle遷移（作業完了）を検知したフラグ。タブを見る（switchTab）までdoneとして表示し続ける。
  const doneSessions = reactive<Record<string, boolean>>({});
  // sessionId → working突入時刻(ms)。経過がWORKING_MIN_DURATION_MS未満ならdone化しない
  // （agent_watchが何もしていないセッションを一瞬workingと誤判定することがあるため）。
  const workingStartedAt: Record<string, number> = {};

  /** status stream WSの状態をマージする。working/blockedが届いたらdoneSessionsをクリアする。 */
  function applyAgentStates(states: Array<{ session_id: string, state: string, source?: string }>) {
    if (!Array.isArray(states)) return;
    for (const entry of states) {
      if (entry && typeof entry.session_id === "string" && typeof entry.state === "string") {
        const sessionId = entry.session_id;
        const prevState = agentStates[sessionId];
        if (entry.state === "working") {
          if (prevState !== "working") workingStartedAt[sessionId] = Date.now();
        } else if (entry.state === "idle") {
          const startedAt = workingStartedAt[sessionId];
          if (prevState === "working" && startedAt !== undefined && Date.now() - startedAt >= WORKING_MIN_DURATION_MS) {
            doneSessions[sessionId] = true;
          }
          delete workingStartedAt[sessionId];
        } else {
          delete workingStartedAt[sessionId];
          delete doneSessions[sessionId];
        }
        agentStates[sessionId] = entry.state;
        if (typeof entry.source === "string") agentStateSources[sessionId] = entry.source;
      }
    }
  }

  function clearAgentState(sessionId: string | null | undefined) {
    if (!sessionId) return;
    delete workingStartedAt[sessionId];
    delete agentStates[sessionId];
    delete agentStateSources[sessionId];
    delete doneSessions[sessionId];
  }

  function clearNotifyFlag(flags: Record<string, boolean>, sessionId: string | null | undefined) {
    if (sessionId) delete flags[sessionId];
  }

  function clearDoneState(sessionId: string | null | undefined) {
    clearNotifyFlag(doneSessions, sessionId);
  }

  // sessionId → notify_phrase検知フラグ。タブ選択でクリアする。
  const phraseNotifySessions = reactive<Record<string, boolean>>({});

  function markPhraseNotify(sessionId: string) {
    if (sessionId) phraseNotifySessions[sessionId] = true;
  }

  function clearPhraseNotify(sessionId: string | null | undefined) {
    clearNotifyFlag(phraseNotifySessions, sessionId);
  }

  function clearSessionNotifyBadges(sessionId: string | null | undefined) {
    clearPhraseNotify(sessionId);
    clearDoneState(sessionId);
  }

  return {
    agentStates,
    agentStateSources,
    doneSessions,
    phraseNotifySessions,
    applyAgentStates,
    clearAgentState,
    clearDoneState,
    markPhraseNotify,
    clearPhraseNotify,
    clearSessionNotifyBadges,
  };
});
