/**
 * API 契約 E2E（ワイヤレベルの互換性検証）。
 *
 * UI 操作フローではなく「HTTP/WS のワイヤ上の約束事」を固定するスペック。
 * バックエンドの Rust 移行（docs/RUST_MIGRATION.md）では実装を段階的に
 * 差し替えるため、UI テストでは検知できない次の互換性をここで担保する:
 *
 * - エラー応答のフィールドが `detail` であること（Backend API ルール）
 * - セキュリティヘッダ（X-Frame-Options 等）が全応答に付くこと
 * - 静的配信のキャッシュ規則（index/sw.js は no-cache、/assets/* は immutable）
 * - /auth/check・/pair/{id} の応答形
 * - WS ハンドシェイクの認証拒否挙動
 *
 * ANY_CONSOLE_URL を Rust フロントに向ければ、同じ契約を移行後の実装にも
 * そのまま適用できる。全テストは読み取りのみ or 自己完結（状態を汚さない）。
 */
import { test, expect, loadToken, login, bearerHeaders, BASE_URL } from "./helpers.js";

const SECURITY_HEADERS = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

test.describe("API contract", () => {
  test("不正トークンの API エラーは detail フィールドで返る", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/auth/check`, {
      headers: bearerHeaders("wrong-token-for-contract"),
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ detail: "Invalid token" });
    // `message` フィールドは使わない（MUST ルール）
    expect(body.message).toBeUndefined();
  });

  test("認証済み /auth/check は auth_method を返す", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    const res = await request.get(`${BASE_URL}/auth/check`, {
      headers: bearerHeaders(token),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.auth_method).toBe("token");
    expect(typeof body.hostname).toBe("string");
  });

  test("セキュリティヘッダが API とトップページの両方に付く", async ({ request }) => {
    for (const path of ["/auth/check", "/"]) {
      const res = await request.get(`${BASE_URL}${path}`);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers()[name], `${path} の ${name}`).toBe(value);
      }
    }
  });

  test("index と sw.js は no-cache、ハッシュ付き assets は immutable", async ({ request }) => {
    const index = await request.get(`${BASE_URL}/`);
    expect(index.status()).toBe(200);
    expect(index.headers()["cache-control"]).toContain("no-cache");
    expect(index.headers()["content-type"]).toContain("text/html");

    const sw = await request.get(`${BASE_URL}/sw.js`);
    expect(sw.status()).toBe(200);
    expect(sw.headers()["cache-control"]).toContain("no-cache");

    // dist ビルド配信時のみ（ソースモードにはハッシュ付き assets が無い）
    const html = await index.text();
    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    test.skip(!asset, "dist ビルド未検出（ソースモード配信）のため assets 検証をスキップ");
    const assetRes = await request.get(`${BASE_URL}${asset}`);
    expect(assetRes.status()).toBe(200);
    expect(assetRes.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("/pair/{id} は SPA シェル（トップページと同一の HTML）を返す", async ({ request }) => {
    const index = await request.get(`${BASE_URL}/`);
    const pair = await request.get(`${BASE_URL}/pair/contract-check-id`);
    expect(pair.status()).toBe(200);
    expect(pair.headers()["content-type"]).toContain("text/html");
    expect(await pair.text()).toBe(await index.text());
  });

  test("存在しないパスは detail 付き 404 で返る", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    const res = await request.get(`${BASE_URL}/no-such-route-for-contract`, {
      headers: bearerHeaders(token),
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(typeof body.detail).toBe("string");
  });

  test("upload-image は未対応 MIME を detail 付き 400 で拒否する", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    // 未認証は 401
    const unauthorized = await request.post(`${BASE_URL}/upload-image`, {
      multipart: {
        file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
      },
    });
    expect(unauthorized.status()).toBe(401);
    // 認証済み + 非画像 MIME は 400（何も保存されないため後始末不要）
    const res = await request.post(`${BASE_URL}/upload-image`, {
      headers: bearerHeaders(token),
      multipart: {
        file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain("Unsupported type");
  });

  test("/system/info と /system/tmux-info の応答形", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    const info = await request.get(`${BASE_URL}/system/info`, { headers: bearerHeaders(token) });
    expect(info.status()).toBe(200);
    const infoBody = await info.json();
    for (const key of ["hostname", "user", "install_dir"]) {
      expect(typeof infoBody[key], key).toBe("string");
    }
    const tmux = await request.get(`${BASE_URL}/system/tmux-info`, {
      headers: bearerHeaders(token),
    });
    expect(tmux.status()).toBe(200);
    const tmuxBody = await tmux.json();
    expect(typeof tmuxBody.prefix).toBe("string");
    expect(typeof tmuxBody.available).toBe("boolean");
    expect(Array.isArray(tmuxBody.sessions)).toBeTruthy();
    // 未認証は 401
    const unauthorized = await request.get(`${BASE_URL}/system/info`);
    expect(unauthorized.status()).toBe(401);
  });

  test("ステータスストリーム WS はトークン必須（不正は接続拒否）", async ({ page }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    // ブラウザから同一オリジンで WS を張るため、ログイン画面（未認証で可）を開く
    await page.goto("/");
    const result = await page.evaluate(
      ([validToken]) => {
        const connect = (token) =>
          new Promise((resolve) => {
            const proto = location.protocol === "https:" ? "wss:" : "ws:";
            const ws = new WebSocket(
              `${proto}//${location.host}/workspaces/statuses/ws?token=${encodeURIComponent(token)}`,
            );
            const timer = setTimeout(() => {
              ws.close();
              resolve({ outcome: "timeout" });
            }, 10_000);
            ws.onmessage = (ev) => {
              clearTimeout(timer);
              ws.close();
              resolve({ outcome: "message", data: String(ev.data).slice(0, 200) });
            };
            ws.onclose = () => {
              clearTimeout(timer);
              resolve({ outcome: "closed" });
            };
          });
        return Promise.all([connect(validToken), connect("wrong-token-for-contract")]);
      },
      [token],
    );
    const [valid, invalid] = result;
    // 正しいトークン: 接続でき、最初のフレームが JSON で届く
    expect(valid.outcome).toBe("message");
    expect(() => JSON.parse(valid.data)).not.toThrow();
    // 不正トークン: メッセージを受け取ることなく接続が拒否される
    expect(invalid.outcome).toBe("closed");
  });

  test("ログアウトでデバイス cookie が失効しログイン画面へ戻る", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    const res = await page.request.post("/auth/logout");
    expect(res.ok()).toBeTruthy();
    // 失効済みデバイス cookie では再認証されない
    await page.reload();
    await expect(page.locator('input[placeholder="Token"]')).toBeVisible({ timeout: 10_000 });
  });
});
