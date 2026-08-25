/**
 * ブラウザタブ（dev serverプレビュー用iframe、ui/stores/browserTabs.ts）として
 * 開いてよいURLか判定する。iframeのsrcへそのまま入れるため http / https のみ
 * 許可する（javascript: 等のスキームを弾く）。サーバー側の
 * server/src/settings.rs `put_browser_tabs` も同じ規則で検証しており、
 * ここはEdit URL入力・サーバーからの復元値に対するクライアント側のガード。
 */
export function isAllowedBrowserTabUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
