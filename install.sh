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
# （= アップデート導線もこのスクリプトの再実行に一本化している。
# `./any-console update` もバイナリ配布モードでは内部的にこのスクリプトを
# 再実行する）。サービスが既に登録済みなら（=更新シナリオ）反映のため
# 自動で再起動する。新規インストールでは対話が必要なサービス登録は行わず
# 案内のみ表示する（標準入力がパイプ占有される curl | bash 実行を想定）。
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

sha256_of_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    error "Neither sha256sum nor shasum found — cannot verify checksum"
  fi
}

verify_checksum() {
  local file="$1" checksum_file="$2" expected actual
  expected="$(awk '{print $1}' "$checksum_file")"
  [ -n "$expected" ] || error "Checksum file is empty or malformed: $checksum_file"
  actual="$(sha256_of_file "$file")"
  if [ "$expected" != "$actual" ]; then
    error "Checksum mismatch for $(basename "$file"): expected $expected, got $actual"
  fi
  info "Checksum verified"
}

# 一時パスへコピーしてから rename する（同一ファイルシステム内の mv は
# atomic）。ダウンロード直後の展開物から INSTALL_DIR へ反映する際、コピー
# 途中でプロセスが落ちても INSTALL_DIR 側の既存ファイルが破損した状態で
# 中途半端に残らないようにするため。
atomic_install_file() {
  local src="$1" dest="$2" tmp
  tmp="${dest}.new.$$"
  cp "$src" "$tmp"
  mv "$tmp" "$dest"
}

atomic_install_dir() {
  local src="$1" dest="$2" tmp old
  tmp="${dest}.new.$$"
  rm -rf "$tmp"
  cp -R "$src" "$tmp"
  old="${dest}.old.$$"
  if [ -d "$dest" ]; then
    mv "$dest" "$old"
  fi
  mv "$tmp" "$dest"
  [ -d "$old" ] && rm -rf "$old"
  return 0
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

  local current_version=""
  [ -f "$INSTALL_DIR/VERSION" ] && current_version="$(cat "$INSTALL_DIR/VERSION")"
  if [ "$current_version" = "$tag" ] && [ "${ANY_CONSOLE_FORCE:-}" != "1" ]; then
    info "any-console is already up to date ($tag)"
    return
  fi
  info "Installing any-console $tag${current_version:+ (currently $current_version)}"

  local asset="any-console-${tag}-${target}.tar.gz"
  local url="https://github.com/$REPO/releases/download/$tag/$asset"
  local checksum_url="${url}.sha256"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  info "Downloading $asset..."
  curl -fsSL -o "$tmp_dir/$asset" "$url" || error "Download failed: $url"
  info "Downloading checksum..."
  curl -fsSL -o "$tmp_dir/$asset.sha256" "$checksum_url" || error "Checksum download failed: $checksum_url"
  verify_checksum "$tmp_dir/$asset" "$tmp_dir/$asset.sha256"

  info "Extracting..."
  tar xzf "$tmp_dir/$asset" -C "$tmp_dir"
  local stage="$tmp_dir/any-console-${tag}-${target}"
  [ -d "$stage" ] || error "Unexpected archive layout (missing $stage)"

  mkdir -p "$INSTALL_DIR"
  # data/・config.json・certs/ には一切触れず、配布物のみを差し替える。
  atomic_install_file "$stage/any-console-server" "$INSTALL_DIR/any-console-server"
  atomic_install_file "$stage/any-console" "$INSTALL_DIR/any-console"
  atomic_install_file "$stage/VERSION" "$INSTALL_DIR/VERSION"
  atomic_install_dir "$stage/agent_manifests" "$INSTALL_DIR/agent_manifests"
  chmod +x "$INSTALL_DIR/any-console-server" "$INSTALL_DIR/any-console"

  info "Installed to $INSTALL_DIR"

  echo ""
  info "Running non-interactive setup (dependency check, default bind)..."
  (cd "$INSTALL_DIR" && ./any-console setup --non-interactive)

  echo ""
  if (cd "$INSTALL_DIR" && ./any-console is-registered) 2>/dev/null; then
    info "Restarting the any-console service to apply the update..."
    if (cd "$INSTALL_DIR" && ./any-console restart); then
      info "=== Update complete ($tag) ==="
    else
      warn "Could not restart automatically — run: cd $INSTALL_DIR && ./any-console restart"
    fi
  else
    info "=== Install complete ($tag) ==="
    echo ""
    echo "Service registration (systemd/launchd) requires an interactive step."
    echo "To finish setup and start any-console as a background service, run:"
    echo ""
    echo "  cd $INSTALL_DIR && ./any-console setup"
  fi
  echo ""
  echo "To update later, just re-run this installer (or run './any-console update'):"
  echo ""
  echo "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash"
}

main "$@"
