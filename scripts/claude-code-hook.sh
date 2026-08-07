#!/bin/sh
# any-console への Claude Code hooks 送信スクリプト。
#
# ~/.claude/settings.json の hooks に、イベント名を引数にして登録する:
#
#   {
#     "hooks": {
#       "PreToolUse":       [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh PreToolUse"}]}],
#       "PostToolUse":      [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh PostToolUse"}]}],
#       "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh UserPromptSubmit"}]}],
#       "Notification":     [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh Notification"}]}],
#       "Stop":             [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh Stop"}]}],
#       "SessionEnd":       [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh SessionEnd"}]}]
#     }
#   }
#
# any-console が生成した tmux セッション内でのみ動作する（接続情報の環境変数が
# 無ければ何もしない）。失敗しても Claude Code の動作を妨げないよう常に 0 で終了する。
[ -n "$ANY_CONSOLE_HOOK_URL" ] || exit 0
[ -n "$ANY_CONSOLE_HOOK_TOKEN" ] || exit 0
[ -n "$ANY_CONSOLE_SESSION" ] || exit 0
EVENT="${1:-}"
[ -n "$EVENT" ] || exit 0
curl -s -m 3 -o /dev/null -X POST "$ANY_CONSOLE_HOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Hook-Token: $ANY_CONSOLE_HOOK_TOKEN" \
  -d "{\"session\":\"$ANY_CONSOLE_SESSION\",\"event\":\"$EVENT\"}" 2>/dev/null || true
exit 0
