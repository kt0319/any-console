/**
 * ジョブフレーズのテンプレート定義。
 * phrases: [{phrase, icon}] — 統合リスト形式。
 * icon には agentStateBadge が解釈できる mdi-* 名を使う。
 */
export const PHRASE_TEMPLATES = [
  {
    id: "claude-code",
    label: "Claude Code",
    phrases: [
      { phrase: "Do you want to proceed?", icon: "mdi-hand-back-right" },
      { phrase: "esc to interrupt", icon: "mdi-hand-back-right" },
      { phrase: "1. Yes", icon: "mdi-arrow-decision" },
    ],
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    phrases: [
      { phrase: "Send a message", icon: "mdi-hand-back-right" },
      { phrase: "ctrl-c to cancel", icon: "mdi-hand-back-right" },
      { phrase: "(y/n)", icon: "mdi-arrow-decision" },
    ],
  },
  {
    id: "aider",
    label: "Aider",
    phrases: [
      { phrase: "Add these files to the chat?", icon: "mdi-hand-back-right" },
      { phrase: "Allow edits to", icon: "mdi-hand-back-right" },
      { phrase: "(y/n)", icon: "mdi-arrow-decision" },
      { phrase: "Tokens:", icon: "mdi-check-circle" },
    ],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    phrases: [
      { phrase: "Approve command?", icon: "mdi-hand-back-right" },
      { phrase: "Press Enter to confirm", icon: "mdi-hand-back-right" },
      { phrase: "(y/n)", icon: "mdi-arrow-decision" },
    ],
  },
];
