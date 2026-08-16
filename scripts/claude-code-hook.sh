#!/bin/sh
# any-console への Claude Code hooks 送信スクリプト。
#
# 自動インストール: `./any-console hooks-setup` が ~/.claude/settings.json に
# このスクリプトを登録する（既存のhooks設定は壊さずマージする）。
#
# 手動で登録する場合は ~/.claude/settings.json の hooks に、イベント名を
# 引数にして登録する:
#
#   {
#     "hooks": {
#       "PreToolUse":       [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh PreToolUse"}]}],
#       "PostToolUse":      [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh PostToolUse"}]}],
#       "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh UserPromptSubmit"}]}],
#       "PreCompact":       [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh PreCompact"}]}],
#       "Notification":     [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh Notification"}]}],
#       "Stop":             [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh Stop"}]}],
#       "SessionEnd":       [{"hooks": [{"type": "command", "command": "/path/to/any-console/scripts/claude-code-hook.sh SessionEnd"}]}]
#     }
#   }
#
# any-console が生成した tmux セッション内でのみ動作する（接続情報の環境変数が
# 無ければ何もしない）。失敗しても Claude Code の動作を妨げないよう常に 0 で終了する。

event="$1"

if [ -z "$ANY_CONSOLE_HOOK_URL" ] || [ -z "$ANY_CONSOLE_HOOK_TOKEN" ] ||
  [ -z "$ANY_CONSOLE_SESSION" ] || [ -z "$event" ]; then
  exit 0
fi

# Notificationイベントはstdinで渡されるJSON（Claude Code側のhookペイロード）に
# 通知本文（message）を含む。許可確認（"needs your permission"）か、単なる
# アイドルリマインダー（"waiting for your input"）かをサーバ側で区別するために
# 拾って送る。jqには依存せず、フラットな文字列フィールドを前提にした簡易な
# sed抽出で十分（Claude CodeのmessageはネストしたJSONを含まず、値にエスケープ
# された引用符も通常含まない）。BSD sed（macOS標準）は基本正規表現で `\|` を
# サポートしないため、`[^"]*` によるシンプルな非貪欲マッチにする。
stdin_json=$(cat 2>/dev/null)
detail=$(printf '%s' "$stdin_json" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)

# detail はサーバ側で #[serde(default)] のため、空でも常に含めてよい。
body="{\"session\":\"$ANY_CONSOLE_SESSION\",\"event\":\"$event\",\"detail\":\"$detail\"}"

(
  # ANY_CONSOLE_HOOK_URL のスキームはサーバの実際の listen 状態に合わせて
  # 組み立てられる（server/src/tmux.rs hook_session_env）。https の場合は
  # loopback 宛てのため証明書のホスト名検証（SAN は ts.net の FQDN）が通らず、
  # 最初から -k で検証をスキップして1発で送る。http の場合は、セッション作成後に
  # サーバが証明書を得てTLSで再起動された環境で素のHTTPが弾かれることがある
  # ため、失敗時のみ https + -k で同じ loopback 宛てに再試行する。
  case "$ANY_CONSOLE_HOOK_URL" in
    https:*)
      curl -sk -m 3 -X POST "$ANY_CONSOLE_HOOK_URL" \
        -H "X-Hook-Token: $ANY_CONSOLE_HOOK_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$body" \
        >/dev/null 2>&1
      ;;
    *)
      https_url=$(printf '%s' "$ANY_CONSOLE_HOOK_URL" | sed 's#^http:#https:#')
      curl -s -m 3 -X POST "$ANY_CONSOLE_HOOK_URL" \
        -H "X-Hook-Token: $ANY_CONSOLE_HOOK_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$body" \
        >/dev/null 2>&1 ||
        curl -sk -m 3 -X POST "$https_url" \
          -H "X-Hook-Token: $ANY_CONSOLE_HOOK_TOKEN" \
          -H "Content-Type: application/json" \
          -d "$body" \
          >/dev/null 2>&1
      ;;
  esac
) &

exit 0
