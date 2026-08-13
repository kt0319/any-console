// PWAインストールプロンプト（beforeinstallprompt）の管理。
//
// ScreenEmpty はタブ全閉/再表示のたびにマウントし直されるため、コンポーネント
// 内でリスナを登録すると (1) 解除されず累積する、(2) 再マウント後の新しい
// インスタンスはイベントを取り逃して常に手動手順へフォールバックしてしまう。
// リスナとキャプチャ済みプロンプトをモジュールスコープで1つだけ持つ
// （usePreviewPorts.ts と同じ単一化パターン）。

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

  /**
   * ネイティブのインストールプロンプトを表示できたら true。
   * できない環境（beforeinstallprompt 非発火の Safari 等）は false を返し、
   * 呼び出し側が手動手順の案内へフォールバックする。
   */
  async function promptInstall(): Promise<boolean> {
    if (!deferredInstallPrompt) return false;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return true;
  }

  return { promptInstall };
}
