import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";

export function useEditorIntegration() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();

  const editorUrlTemplate = ref("");
  const systemInfo = ref({});

  async function fetchEditorSettings() {
    try {
      const [settingsResult, infoResult] = await Promise.all([
        apiGet("/settings/editor"),
        apiGet("/system/info"),
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
    let url = tmpl
      .replace(/\{user\}/g, systemInfo.value.user || "")
      .replace(/\{host\}/g, systemInfo.value.hostname || "")
      .replace(/\{work_dir\}/g, systemInfo.value.work_dir || "")
      .replace(/\{workspace\}/g, workspace);
    if (path) url += "/" + path;
    return url;
  }

  function openInEditor(path) {
    const url = buildEditorUrl(path);
    if (url) window.open(url, "_blank");
  }

  return {
    editorUrlTemplate,
    fetchEditorSettings,
    buildEditorUrl,
    openInEditor,
  };
}
