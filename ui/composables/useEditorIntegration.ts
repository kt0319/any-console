import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { EP_SETTINGS_EDITOR, EP_SYSTEM_INFO } from "../utils/endpoints.ts";
import { isTouchInput } from "../utils/device.ts";
import { openExternal } from "../utils/open-external.ts";
import { useToast } from "./useToast.ts";

export function useEditorIntegration() {
  const toast = useToast();
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();

  const editorUrlTemplate = ref("");
  const systemInfo = ref<{ user?: string, hostname?: string, home_dir?: string }>({});

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

  function buildEditorUrl(path?: string) {
    const tmpl = editorUrlTemplate.value;
    if (!tmpl) return "";
    const workspace = workspaceStore.selectedWorkspace || "";
    const rawWorkspacePath = workspaceStore.currentWorkspace?.path || "";
    // workspace path は `~/...` 形式で返り、そのまま連結すると不正なホスト名になるため絶対パスに展開する。
    const homeDir = systemInfo.value.home_dir || "";
    const workspacePath = homeDir && rawWorkspacePath.startsWith("~/")
      ? homeDir + rawWorkspacePath.slice(1)
      : rawWorkspacePath;
    let url = tmpl
      .replace(/\{user\}/g, systemInfo.value.user || "")
      .replace(/\{host\}/g, systemInfo.value.hostname || "")
      .replace(/\{workspace\}/g, workspace)
      .replace(/\{workspace_path\}/g, workspacePath);
    if (path) url += "/" + path;
    return url;
  }

  function openInEditor(path?: string) {
    // モバイルでは vscode:// 等を開くアプリが無く window.open() が黙って失敗するため、トーストで理由を示す。
    if (isTouchInput()) {
      toast.info("Editor integration isn't available on mobile");
      return;
    }
    const url = buildEditorUrl(path);
    openExternal(url);
  }

  return {
    editorUrlTemplate,
    systemInfo,
    fetchEditorSettings,
    buildEditorUrl,
    openInEditor,
  };
}
