import { defineStore } from "pinia";
import { reactive } from "vue";
import { WORKING_MIN_DURATION_MS } from "../utils/constants.ts";

/**
 * セッション単位のエージェント状態と「見たら消える」通知バッジ
 * （stores/terminal.ts から分離 — キーはタブ ID ではなく sessionId で、
 * タブの開閉とは独立したライフサイクルを持つ）。status stream WS
 * （useStatusStream.ts）が更新し、タブ・サイドバー表示が参照する。
 */
export const useAgentStateStore = defineStore("agent-state", () => {
  // sessionId → エージェント状態（backendはblocked/working/idleのみを送る）。
  const agentStates = reactive<Record<string, string>>({});
  // sessionId → 判定元（"hook"/"manifest"/"screen"、デバッグ表示専用）。
  // agentStatesと同じタイミングでWSから届く（agent_watch.rsのstates_payload）。
  const agentStateSources = reactive<Record<string, string>>({});
  // sessionId → true。working から idle への遷移（=作業完了）を検知した
  // セッション。idle自体はバッジ非表示にするため、タブを見る（switchTab）
  // までは「done」として表示し続けるための別レイヤー。
  const doneSessions = reactive<Record<string, boolean>>({});
  // sessionId → working状態に入った時刻(ms)。working→idle遷移時にここからの
  // 経過が WORKING_MIN_DURATION_MS 未満なら done化しない（backendのagent_watchが
  // 実際には何も作業していないセッションを、画面のちらつき等で一瞬working扱いに
  // してしまうことがあり、それを「作業完了」と誤認するのを防ぐため）。
  const workingStartedAt: Record<string, number> = {};

  /**
   * status stream WS から届いたエージェント状態をマージする。idle以外
   * （working/blocked）が届いたら doneSessions はクリアする（新しい作業の開始、
   * またはblockedでの入力待ちがdoneより優先されるため）。
   */
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

  // sessionId → true の「見たら消えるバッジ」フラグ共通の解除処理
  // （doneSessions/phraseNotifySessionsで重複していたロジックを共通化）。
  function clearNotifyFlag(flags: Record<string, boolean>, sessionId: string | null | undefined) {
    if (sessionId) delete flags[sessionId];
  }

  function clearDoneState(sessionId: string | null | undefined) {
    clearNotifyFlag(doneSessions, sessionId);
  }

  // sessionId → notify_phrase 検知フラグ。タブが選択されたら見た扱いでクリアする。
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
