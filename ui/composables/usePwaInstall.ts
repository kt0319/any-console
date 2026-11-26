// PWAインストールプロンプト（beforeinstallprompt）の管理。
// ScreenEmpty は再マウントされるため、リスナとキャプチャ済みプロンプトはモジュールスコープで1つだけ持つ（累積・取り逃し防止）。

/** beforeinstallprompt でキャプチャした遅延プロンプト（Safari等では発火しない）。 */
let deferredInstallPrompt: any = null;
let listenerRegistered = false;

function ensureListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
}

export function usePwaInstall() {
  ensureListener();

  /** ネイティブのインストールプロンプトを表示できたら true。できない環境（Safari 等）は false を返し、呼び出し側が手動手順へ案内する。 */
  async function promptInstall(): Promise<boolean> {
    if (!deferredInstallPrompt) return false;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return true;
  }

  return { promptInstall };
}
