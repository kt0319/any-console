// @ts-check
import { token, setToken, serverHostname, setServerHostname, serverVersion, setServerVersion, serverDisconnected, setServerDisconnected, isHandlingUnauthorized, setIsHandlingUnauthorized, selectedWorkspace } from './state-core.js';
import { apiFetch } from './api-client.js';
import { $, showLogin, showApp, showToast } from './utils.js';
import { clearPersistedApiCaches } from './cache.js';
import { initApp } from './bootstrap.js';

/**
 * Saves the auth token to localStorage and cookie.
 * Clears persisted API caches if the token has changed.
 * @param {string} val
 */
export function saveToken(val) {
  const prev = localStorage.getItem("pi_console_token") || "";
  if (prev && prev !== val) {
    clearPersistedApiCaches();
  }
  localStorage.setItem("pi_console_token", val);
  document.cookie = `pi_console_token=${encodeURIComponent(val)};path=/;max-age=31536000;SameSite=Strict`;
}

/**
 * Removes the auth token from localStorage and cookie, and clears persisted API caches.
 */
export function clearToken() {
  clearPersistedApiCaches();
  localStorage.removeItem("pi_console_token");
  document.cookie = "pi_console_token=;path=/;max-age=0;SameSite=Strict";
}

/**
 * Loads the auth token from localStorage or cookie.
 * @returns {string}
 */
export function loadToken() {
  const ls = localStorage.getItem("pi_console_token");
  if (ls) return ls;
  const match = document.cookie.match(/(?:^|;\s*)pi_console_token=([^;]*)/);
  if (match) {
    try {
      const val = decodeURIComponent(match[1]);
      if (val) {
        localStorage.setItem("pi_console_token", val);
        return val;
      }
    } catch {}
  }
  return "";
}

/**
 * Checks the current token against the server's auth endpoint.
 * @returns {Promise<{ok: true, hostname: string, version: string} | {ok: false, auth: boolean, error: string}>}
 */
export async function checkToken() {
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { ok: false, auth: false, error: "認証に失敗しました" };
    const data = await res.json();
    return { ok: true, hostname: data.hostname, version: data.version };
  } catch (e) {
    return { ok: false, auth: true, error: `サーバーに接続できません: ${e.message}` };
  }
}

/**
 * Handles a 401 Unauthorized response by verifying the token.
 * If the token is rejected, clears it and shows the login screen.
 * @param {string} [caller]
 * @returns {Promise<boolean>} true if the user was logged out
 */
export async function handleUnauthorized(caller) {
  if (isHandlingUnauthorized || !token) return false;
  setIsHandlingUnauthorized(true);
  console.warn(`[auth] 401 from: ${caller || "unknown"}, verifying token...`);
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      console.warn("[auth] token rejected by /auth/check, logging out");
      clearToken();
      setToken("");
      showLogin();
      return true;
    }
    console.warn("[auth] token still valid, ignoring 401");
  } catch {
  } finally {
    setIsHandlingUnauthorized(false);
  }
  return false;
}

/**
 * Reads the token from the login input, verifies it, and if valid saves it and initializes the app.
 */
export async function login() {
  const input = $("token-input");
  setToken(input.value.trim());
  if (!token) return;

  const result = await checkToken();
  if (result.ok) {
    setServerInfo(result.hostname, result.version);
    saveToken(token);
    $("login-error").style.display = "none";
    showApp();
    await initApp();
  } else {
    showToast(result.error);
    setToken("");
  }
}

/**
 * Updates the in-memory server hostname and version, then refreshes the document title.
 * @param {string} hostname
 * @param {string} version
 */
export function setServerInfo(hostname, version) {
  if (hostname) setServerHostname(hostname);
  if (version) setServerVersion(version);
  updateDocumentTitle();
}

/**
 * Updates the document title based on the current server hostname and selected workspace.
 */
export function updateDocumentTitle() {
  const hadNotify = document.title.startsWith("* ");
  const parts = [serverHostname, selectedWorkspace].filter(Boolean);
  document.title = (hadNotify ? "* " : "") + (parts.length > 0 ? parts.join(" - ") : "pi-console");
}

setToken(loadToken());
