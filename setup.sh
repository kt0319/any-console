#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

error() { echo -e "${RED}エラー: $1${NC}" >&2; exit 1; }
info()  { echo -e "${GREEN}$1${NC}"; }
warn()  { echo -e "${YELLOW}$1${NC}"; }

info "=== any-console セットアップ ==="

# 依存チェック（まとめて報告）
missing=()
for cmd in python3 node git tmux; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing+=("$cmd")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo ""
  error_msg="以下のコマンドが見つかりません: ${missing[*]}"
  echo -e "${RED}${error_msg}${NC}" >&2
  echo ""
  echo "インストール例:"
  echo "  Debian/Ubuntu: sudo apt install ${missing[*]}"
  echo "  macOS:         brew install ${missing[*]}"
  exit 1
fi

# Python バージョンチェック (3.11+)
python_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
python_major=$(echo "$python_version" | cut -d. -f1)
python_minor=$(echo "$python_version" | cut -d. -f2)
if [ "$python_major" -lt 3 ] || { [ "$python_major" -eq 3 ] && [ "$python_minor" -lt 11 ]; }; then
  error "Python 3.11+ が必要です（現在: $python_version）"
fi
info "✓ 依存OK: Python $python_version, node $(node -v), git $(git --version | cut -d' ' -f3), tmux $(tmux -V | cut -d' ' -f2)"

# pip install
info "Python依存パッケージをインストール中..."
pip install -r requirements.txt

# npm install + build
info "Node.js依存パッケージをインストール中..."
npm install

info "フロントエンドをビルド中..."
npm run build

# .env セットアップ
if [ -f .env ]; then
  info "✓ .env は既に存在します（スキップ）"
else
  token=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  cp .env.example .env
  sed -i"" -e "s/ANY_CONSOLE_TOKEN=your-secret-token/ANY_CONSOLE_TOKEN=${token}/" .env
  info "✓ .env を生成しました（トークン自動設定済み）"
fi

echo ""
info "=== セットアップ完了 ==="
echo ""
echo "起動:"
echo "  python -m api.main"
echo ""
echo "ブラウザで http://localhost:8888 を開いてください。"
echo "認証トークンは .env の ANY_CONSOLE_TOKEN を確認してください。"
