import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { EP_SETTINGS_EDITOR, EP_SYSTEM_INFO } from "../utils/endpoints.js";
import { isTouchInput } from "../utils/device.js";
import { openExternal } from "../utils/open-external.js";
import { emit } from "../app-bridge.js";

export function useEditorIntegration() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();

  const editorUrlTemplate = ref("");
  /** @type {import("vue").Ref<{ user?: string, hostname?: string }>} */
  const systemInfo = ref({});

  async function fetchEditorSettings() {
    try {
      const [settingsResult, infoResult] = await Promise.all([
        getWithRetry(apiGet, EP_SETTINGS_EDITOR),
        getWithRetry(apiGet, EP_SYSTEM_INFO),
      ]);
      const settings = settingsResult.ok ? settingsResult.data : {};
      const info = infoResult.ok ? infoResult.data : {};
      editorUrlTemplate.value = (settings.url_template || "").trim();
      systemInfo.value = info;
    } catch {
      editorUrlTemplate.value = "";
    }
  }

  function buildEditorUrl(path) {
    const tmpl = editorUrlTemplate.value;
    if (!tmpl) return "";
    const workspace = workspaceStore.selectedWorkspace || "";
    const workspacePath = workspaceStore.currentWorkspace?.path || "";
    let url = tmpl
      .replace(/\{user\}/g, systemInfo.value.user || "")
      .replace(/\{host\}/g, systemInfo.value.hostname || "")
      .replace(/\{workspace\}/g, workspace)
      .replace(/\{workspace_path\}/g, workspacePath);
    if (path) url += "/" + path;
    return url;
  }

  function openInEditor(path) {
    // vscode:// 等のカスタムURLスキームはローカルのデスクトップエディタを起動する
    // 前提のため、モバイルでは対応するアプリが無くwindow.open()が黙って失敗する
    // （何も起きたように見えない）。理由が分かるようトーストで明示する。
    if (isTouchInput()) {
      emit("toast:show", { message: "Editor integration isn't available on mobile", type: "info" });
      return;
    }
    const url = buildEditorUrl(path);
    openExternal(url);
  }

  return {
    editorUrlTemplate,
    fetchEditorSettings,
    buildEditorUrl,
    openInEditor,
  };
}
