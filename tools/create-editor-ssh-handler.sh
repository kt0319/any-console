#!/bin/bash
set -euo pipefail

# エディタコマンド（デフォルト: zed）
EDITOR_CMD="${1:-zed}"

APP_NAME="EditorSSHHandler"
APP_DIR="$HOME/Applications/${APP_NAME}.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
SCRIPT_NAME="handler"

echo "Creating ${APP_NAME}.app in ~/Applications/ ..."
echo "Editor command: ${EDITOR_CMD}"

mkdir -p "${MACOS_DIR}"

cat > "${CONTENTS_DIR}/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.custom.editor-ssh-handler</string>
    <key>CFBundleName</key>
    <string>EditorSSHHandler</string>
    <key>CFBundleExecutable</key>
    <string>handler</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>Editor SSH Remote</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>editor-ssh</string>
            </array>
        </dict>
    </array>
    <key>LSBackgroundOnly</key>
    <true/>
</dict>
</plist>
PLIST

cat > "${MACOS_DIR}/${SCRIPT_NAME}" << HANDLER
#!/bin/bash
url="\$1"
# editor-ssh://user@host/path -> ssh://user@host/path
ssh_url="\${url/editor-ssh:\\/\\//ssh:\\/\\/}"
${EDITOR_CMD} "\${ssh_url}"
HANDLER

chmod +x "${MACOS_DIR}/${SCRIPT_NAME}"

# Register the URL scheme handler
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -R "${APP_DIR}" 2>/dev/null || true

echo ""
echo "Done: ${APP_DIR}"
echo "URL scheme 'editor-ssh://' is now registered."
echo "Editor: ${EDITOR_CMD}"
echo ""
echo "Usage:"
echo "  ./create-app.sh           # default: zed"
echo "  ./create-app.sh zed       # Zed"
echo "  ./create-app.sh code      # VS Code"
echo ""
echo "Test: open 'editor-ssh://user@host/path/to/file'"
