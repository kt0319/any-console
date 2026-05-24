import { ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useSessionSync } from "./useSessionSync.js";
import { emit } from "../app-bridge.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES, EP_SETTINGS_CONFIG_HEALTH } from "../utils/endpoints.js";

export function useAppBootstrap() {
  const auth = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const { restoreExistingSessions } = useSessionSync();

  const booting = ref(true);
  const bootMessage = ref("Loading...");

  async function initializeApp() {
    bootMessage.value = "Loading...";

    const workspacesPromise = workspaceStore.fetchWorkspaces().then(() => {
      if (!workspaceStore.selectedWorkspace) {
        const first = workspaceStore.visibleWorkspaces[0];
        if (first) workspaceStore.selectedWorkspace = first.name;
      }
    }).catch((e) => console.error("workspaces fetch failed:", e));

    const sessionsPromise = auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null);
    const jobsPromise = auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null);
    const healthPromise = auth.apiFetch(EP_SETTINGS_CONFIG_HEALTH).catch(() => null);

    const [, sessionsRes, jobsRes, healthRes] = await Promise.all([workspacesPromise, sessionsPromise, jobsPromise, healthPromise]);

    if (healthRes?.ok) {
      const health = await healthRes.json();
      if (!health.ok) {
        const msg = health.source === "config.bak"
          ? "Config was restored from backup. Some settings may be missing."
          : `Config has validation errors: ${health.errors.map((e) => e.key).join(", ")}`;
        emit("toast:show", { message: msg, type: "warning" });
      }
    }

    bootMessage.value = "Restoring sessions...";
    await restoreExistingSessions(sessionsRes, jobsRes);

    workspaceStore.fetchStatuses();
  }

  return { booting, bootMessage, initializeApp };
}
