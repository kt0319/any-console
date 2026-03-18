#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

error() { echo -e "${RED}エラー: $1${NC}" >&2; exit 1; }
info()  { echo -e "${GREEN}$1${NC}"; }

# 依存チェック
check_command() {
  command -v "$1" >/dev/null 2>&1 || error "$1 が見つかりません。インストールしてください。"
}

info "=== any-console セットアップ ==="

check_command python3
check_command node
check_command git
check_command tmux

# Python バージョンチェック (3.11+)
python_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
python_major=$(echo "$python_version" | cut -d. -f1)
python_minor=$(echo "$python_version" | cut -d. -f2)
if [ "$python_major" -lt 3 ] || { [ "$python_major" -eq 3 ] && [ "$python_minor" -lt 11 ]; }; then
  error "Python 3.11+ が必要です（現在: $python_version）"
fi
info "✓ Python $python_version"

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
echo "起動コマンド:"
echo "  python -m uvicorn api.main:app --host 0.0.0.0 --port 8888"
echo ""
echo "ブラウザで http://localhost:8888 を開いてください。"
