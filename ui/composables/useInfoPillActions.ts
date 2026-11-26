import type { ComputedRef, Ref } from "vue";
import { emit } from "../app-bridge.ts";
import { useApi } from "./useApi.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { terminalSessionCwdPath } from "../utils/endpoints.ts";
import { resolveBareTerminalFilesDetail, resolveRegisterCurrentDirAction } from "../utils/bare-terminal-actions.ts";
import { useDevServerOpen } from "./useDevServerOpen.ts";
import { openWorkspaceAdd } from "./useSessionOpenNav.ts";

export function useInfoPillActions({ tab, isGitRepo, devServerEntry, ahead, behind }: {
  tab: Ref<Record<string, any>>,
  isGitRepo: Ref<boolean> | ComputedRef<boolean>,
  devServerEntry: Ref<Record<string, any> | null> | ComputedRef<Record<string, any> | null>,
  ahead?: Ref<number> | ComputedRef<number>,
  behind?: Ref<number> | ComputedRef<number>,
}) {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();
  const { confirmOpenDevServer } = useDevServerOpen();

  function openWorkspacePane(pane: string, extra: Record<string, any> = {}) {
    if (!tab.value.workspace) return;
    workspaceStore.selectedWorkspace = tab.value.workspace;
    emit("git:openFileModal", { pane, ...extra });
  }

  // Push/Pull 件数がある時だけ Branch 一覧を展開する（無ければ History 優先）
  function openBranch() {
    const hasPushPull = (ahead?.value || 0) > 0 || (behind?.value || 0) > 0;
    openWorkspacePane("branch", { expandBranch: hasPushPull });
  }

  async function fetchCwd() {
    if (!tab.value.sessionId) return "";
    const { ok, data } = await apiGet(terminalSessionCwdPath(tab.value.sessionId));
    return ok ? (data?.cwd || "") : "";
  }

  // 非 Git・未紐付けのターミナルはワークスペースパスではなくセッションの実 cwd から Files を開く
  async function openBareTerminalFiles() {
    const cwd = tab.value.sessionId ? await fetchCwd() : "";
    emit("git:openFileModal", resolveBareTerminalFilesDetail(tab.value.sessionId, cwd));
  }

  function openFiles() {
    if (isGitRepo.value && tab.value.workspace) {
      workspaceStore.selectedWorkspace = tab.value.workspace;
      emit("git:openFileModal", { pane: "files" });
    } else {
      openBareTerminalFiles();
    }
  }

  // ラベル/アイコンは固定。Add/Open のどちらかはクリック時に cwd を見て判定する
  async function registerCurrentDir() {
    if (!tab.value.sessionId) return;
    const cwd = await fetchCwd();
    const workspaces = workspaceStore.allWorkspaces as { name: string, path: string, icon?: string, icon_color?: string }[];
    const action = resolveRegisterCurrentDirAction(cwd, workspaces);
    if (action.type === "openModal") {
      emit("workspace:openModal");
    } else if (action.type === "launch") {
      emit("terminal:launch", { workspace: action.workspace, icon: action.icon, iconColor: action.iconColor });
    } else {
      openWorkspaceAdd({ initialPath: action.initialPath, attachSessionId: tab.value.sessionId, attachTabId: tab.value.id });
    }
  }

  async function openDevServer() {
    const p = devServerEntry.value;
    if (!p) return;
    confirmOpenDevServer(p);
  }

  // 常に Dispatch タブを開く。split mode で非アクティブペインのピルを押しても正しいセッションを選べるよう、このタブの sessionId を渡す
  function openDispatch() {
    openWorkspacePane("dispatch", { sessionId: tab.value.sessionId || null });
  }

  // devserver-stop は遷移先が無いため default へ
  function openPane(key: string | null | undefined) {
    switch (key) {
      case "workspace":
      case "files":
        return openFiles();
      case "branch":
        return openBranch();
      case "changes":
      case "prs":
      case "actions":
      case "docker":
      case "issues":
        return openWorkspacePane(key);
      case "devserver":
        return openDevServer();
      case "add":
        return registerCurrentDir();
      case "dispatch":
        return openDispatch();
      default:
        return undefined;
    }
  }

  return { openPane };
}
