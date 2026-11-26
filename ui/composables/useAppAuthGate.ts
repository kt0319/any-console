import { ref } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { useToast } from "./useToast.ts";

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
    const result = await auth.checkSession();
    if (result.ok) {
      auth.markAuthenticated();
      auth.setServerInfo(result.hostname);
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
