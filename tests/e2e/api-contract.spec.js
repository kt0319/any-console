/**
 * API 契約 E2E。UI テストでは検知できないワイヤ上の約束事（`detail` エラー形式・セキュリティヘッダ・
 * 静的配信のキャッシュ規則・/auth/check /pair /snippets /auth/pairing の応答形・WS 認証拒否）を固定する。
 * 全テストは読み取りのみ or 自己完結（状態を汚さない）。
 */
import { test, expect, loadToken, login, bearerHeaders, BASE_URL, TOKEN_REQUIRED_MSG } from "./helpers.js";

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
    test.skip(!token, TOKEN_REQUIRED_MSG);
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
    test.skip(!token, TOKEN_REQUIRED_MSG);
    const res = await request.get(`${BASE_URL}/no-such-route-for-contract`, {
      headers: bearerHeaders(token),
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(typeof body.detail).toBe("string");
  });

  test("upload-image は未対応 MIME を detail 付き 400 で拒否する", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
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
    test.skip(!token, TOKEN_REQUIRED_MSG);
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
    const unauthorized = await request.get(`${BASE_URL}/system/info`);
    expect(unauthorized.status()).toBe(401);
  });

  test("/snippets はトークン必須で snippets 配列を返す", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    const res = await request.get(`${BASE_URL}/snippets`, { headers: bearerHeaders(token) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.snippets)).toBeTruthy();
    const unauthorized = await request.get(`${BASE_URL}/snippets`);
    expect(unauthorized.status()).toBe(401);
  });

  test("未知のペアリング ID の status は not_found を返す", async ({ request }) => {
    // status は新デバイス側（未認証）からポーリングされる契約のため認証不要
    const res = await request.get(`${BASE_URL}/auth/pairing/pr_contract_check/status`);
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("not_found");
  });

  test("ペアリング開始は認証必須で、応答形が契約どおり", async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    const unauthorized = await request.post(`${BASE_URL}/auth/pairing/start`);
    expect(unauthorized.status()).toBe(401);

    const res = await request.post(`${BASE_URL}/auth/pairing/start`, {
      headers: bearerHeaders(token),
    });
    if (res.status() === 400) {
      // localhost 経由では他端末から到達できる URL を組み立てられないため拒否される契約
      expect((await res.json()).detail).toContain("localhost");
    } else {
      // LAN / Tailscale 経由の外部サーバでは id / url / expires_in_sec を返す。
      // エントリは短命（90 秒）かつメモリ内のみのため後始末は不要
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.id).toMatch(/^pr_/);
      expect(body.url).toContain(`/pair/${body.id}?t=`);
      expect(typeof body.expires_in_sec).toBe("number");
    }
  });

  test("ステータスストリーム WS はトークン必須（不正は接続拒否）", async ({ page }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
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
    expect(valid.outcome).toBe("message");
    expect(() => JSON.parse(valid.data)).not.toThrow();
    expect(invalid.outcome).toBe("closed");
  });

  test("ログアウトでデバイス cookie が失効しログイン画面へ戻る", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
    const res = await page.request.post("/auth/logout");
    expect(res.ok()).toBeTruthy();
    await page.reload();
    await expect(page.locator('input[placeholder="Token"]')).toBeVisible({ timeout: 10_000 });
  });
});
