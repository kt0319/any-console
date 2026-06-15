import { ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useToast } from "./useToast.js";

/**
 * App.vue の認証ゲート。
 * - 起動時のトークン検証
 * - ログイン画面 / メイン画面の表示切替フラグ管理
 */
export function useAppAuthGate() {
  const auth = useAuthStore();
  const toast = useToast();

  const showLogin = ref(false);
  const authenticated = ref(false);

  async function onAuthenticated() {
    showLogin.value = false;
    authenticated.value = true;
  }

  async function checkAuthOnBoot() {
    const result = await auth.checkToken();
    if (result.ok) {
      auth.markAuthenticated();
      auth.setServerInfo(result.hostname, result.version);
      await onAuthenticated();
    } else if (!result.auth) {
      showLogin.value = true;
    } else {
      toast.error(result.error);
      authenticated.value = true;
    }
  }

  return { showLogin, authenticated, onAuthenticated, checkAuthOnBoot };
}
