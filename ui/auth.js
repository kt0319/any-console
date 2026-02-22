function saveToken(val) {
  localStorage.setItem("pi_console_token", val);
  document.cookie = `pi_console_token=${encodeURIComponent(val)};path=/;max-age=31536000;SameSite=Strict`;
}

function clearToken() {
  localStorage.removeItem("pi_console_token");
  document.cookie = "pi_console_token=;path=/;max-age=0;SameSite=Strict";
}

function loadToken() {
  const ls = localStorage.getItem("pi_console_token");
  if (ls) return ls;
  const match = document.cookie.match(/(?:^|;\s*)pi_console_token=([^;]*)/);
  if (match) {
    const val = decodeURIComponent(match[1]);
    if (val) {
      localStorage.setItem("pi_console_token", val);
      return val;
    }
  }
  return "";
}

async function checkToken() {
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { ok: false, auth: false, error: "認証に失敗しました" };
    return { ok: true };
  } catch (e) {
    return { ok: false, auth: true, error: `サーバーに接続できません: ${e.message}` };
  }
}

async function handleUnauthorized(caller) {
  if (handlingUnauthorized || !token) return false;
  handlingUnauthorized = true;
  console.warn(`[auth] 401 from: ${caller || "unknown"}, verifying token...`);
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      console.warn("[auth] token rejected by /auth/check, logging out");
      clearToken();
      token = "";
      showLogin();
      return true;
    }
    console.warn("[auth] token still valid, ignoring 401");
  } catch {
  } finally {
    handlingUnauthorized = false;
  }
  return false;
}

async function login() {
  const input = $("token-input");
  token = input.value.trim();
  if (!token) return;

  const result = await checkToken();
  if (result.ok) {
    saveToken(token);
    $("login-error").style.display = "none";
    showApp();
    await initApp();
  } else {
    showToast(result.error);
    token = "";
  }
}

token = loadToken();
