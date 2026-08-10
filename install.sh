#!/usr/bin/env bash
# any-console のバイナリ配布インストーラ。
#
# GitHub Releases から自分の OS/arch 向けの tarball を取得し、
# ~/.any-console へ展開する（Rust/cargo/Node/npm/Python venv の事前準備は不要。
# 実行時に python3・git・tmux のみが必要）。
#
# 使い方:
#   curl -fsSL https://raw.githubusercontent.com/kt0319/any-console/main/install.sh | bash
#
# 冪等: 既存の ~/.any-console に対して再実行すると、data/・config.json・certs/
# には一切触れずバイナリ・スクリプト・agent_manifests のみを最新版へ差し替える
# （= アップデート導線もこのスクリプトの再実行に一本化している）。
set -euo pipefail

REPO="kt0319/any-console"
INSTALL_DIR="${ANY_CONSOLE_INSTALL_DIR:-$HOME/.any-console}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
error() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux) os="unknown-linux-gnu" ;;
    Darwin) os="apple-darwin" ;;
    *) error "Unsupported OS: $os (any-console supports Linux and macOS)" ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) error "Unsupported architecture: $arch" ;;
  esac
  echo "${arch}-${os}"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "$1 is required but not found. Please install it first."
}

main() {
  require_cmd curl
  require_cmd tar

  local target
  target="$(detect_target)"
  info "Detected platform: $target"

  local tag
  if [ -n "${ANY_CONSOLE_VERSION:-}" ]; then
    tag="$ANY_CONSOLE_VERSION"
  else
    info "Looking up the latest release..."
    tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)"
    [ -n "$tag" ] || error "Could not determine the latest release tag. Check https://github.com/$REPO/releases"
  fi
  info "Installing any-console $tag"

  local asset="any-console-${tag}-${target}.tar.gz"
  local url="https://github.com/$REPO/releases/download/$tag/$asset"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  info "Downloading $asset..."
  curl -fsSL -o "$tmp_dir/$asset" "$url" || error "Download failed: $url"

  info "Extracting..."
  tar xzf "$tmp_dir/$asset" -C "$tmp_dir"
  local stage="$tmp_dir/any-console-${tag}-${target}"
  [ -d "$stage" ] || error "Unexpected archive layout (missing $stage)"

  mkdir -p "$INSTALL_DIR"
  # data/・config.json・certs/ には一切触れず、配布物のみを上書きコピーする
  # （再実行時の冪等アップデート導線としても使うため）。
  cp "$stage/any-console-server" "$INSTALL_DIR/"
  cp "$stage/any-console" "$INSTALL_DIR/"
  cp "$stage/VERSION" "$INSTALL_DIR/"
  rm -rf "$INSTALL_DIR/agent_manifests"
  cp -R "$stage/agent_manifests" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/any-console-server" "$INSTALL_DIR/any-console"

  info "Installed to $INSTALL_DIR"

  echo ""
  info "Running non-interactive setup (dependency check, default bind)..."
  (cd "$INSTALL_DIR" && ./any-console setup --non-interactive)

  echo ""
  info "=== Install complete ==="
  echo ""
  echo "Service registration (systemd/launchd) requires an interactive step."
  echo "To finish setup and start any-console as a background service, run:"
  echo ""
  echo "  cd $INSTALL_DIR && ./any-console setup"
  echo ""
  echo "To update later, just re-run this installer:"
  echo ""
  echo "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash"
}

main "$@"
