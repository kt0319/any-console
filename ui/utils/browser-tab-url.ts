/**
 * ブラウザタブ（dev serverプレビュー用iframe、ui/stores/browserTabs.ts）として
 * 開いてよいURLか判定する。iframeのsrcへそのまま入れるため http / https のみ
 * 許可する（javascript: 等のスキームを弾く）。サーバー側の
 * server/src/settings.rs `put_browser_tabs` も同じ規則で検証しており、
 * ここはEdit URL入力・サーバーからの復元値に対するクライアント側のガード。
 */
export function isAllowedBrowserTabUrl(url: unknown): url is string {
  return normalizeBrowserTabUrl(url) != null;
}

/**
 * ブラウザタブとして保存するURLを正規化して返す（許可外・不正はnull）。
 * `new URL()` は `https:example.com` のような省略形も受理するが、その生文字列
 * をそのまま保存するとサーバー側の literal な `https://` prefix 検証（422）と
 * 食い違い、保存だけが黙って失敗する。必ず `parsed.href`（`scheme://` 形式が
 * 保証される）に揃えてからストアへ入れること。
 */
export function normalizeBrowserTabUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
