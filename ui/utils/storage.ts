export function safeJsonLoad<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** JSON.stringify して保存する。quota 超過やプライベートモード等の例外は握り潰す。 */
export function safeJsonSave(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota — ignore */ }
}

/** 文字列をそのまま読み出す。未保存・例外（プライベートモード等）は null。 */
export function safeStringLoad(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 文字列をそのまま保存する。quota 超過やプライベートモード等の例外は握り潰す。 */
export function safeStringSave(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch { /* quota — ignore */ }
}

/** "1" が保存されていれば true（boolean フラグの読み出し規約）。 */
export function safeFlagLoad(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** true なら "1" を保存、false ならキー自体を削除する（boolean フラグの保存規約）。 */
export function safeFlagSave(key: string, value: unknown) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch { /* quota — ignore */ }
}
