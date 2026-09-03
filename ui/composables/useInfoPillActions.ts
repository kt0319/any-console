import type { ComputedRef, Ref } from "vue";
import { emit } from "../app-bridge.ts";
import { useApi } from "./useApi.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { terminalSessionCwdPath } from "../utils/endpoints.ts";
import { resolveBareTerminalFilesDetail, resolveRegisterCurrentDirAction } from "../utils/bare-terminal-actions.ts";
import { useDevServerOpen } from "./useDevServerOpen.ts";
import { openWorkspaceAdd } from "./useSessionOpenNav.ts";

// Info Pills（TerminalPane）のクリック時の遷移先。通常ピルとpeekピルの両方が同じopenPane(key)を使う。
export function useInfoPillActions({ tab, isGitRepo, devServerEntry, ahead, behind }: {
  tab: Ref<Record<string, any>>,
  isGitRepo: Ref<boolean> | ComputedRef<boolean>,
  devServerEntry: Ref<Record<string, any> | null> | ComputedRef<Record<string, any> | null>,
  ahead?: Ref<number> | ComputedRef<number>,
  behind?: Ref<number> | ComputedRef<number>,
}) {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi() as {
    apiGet: (endpoint: string, opts?: { errorMessage?: string }) => Promise<{ ok: boolean, data: any }>,
  };
  const { confirmOpenDevServer } = useDevServerOpen();

  function openWorkspacePane(pane: string, extra: Record<string, any> = {}) {
    if (!tab.value.workspace) return;
    workspaceStore.selectedWorkspace = tab.value.workspace;
    emit("git:openFileModal", { pane, ...extra });
  }

  // Push/Pull件数がある時だけBranch一覧を展開する（無い時はHistory優先で畳んで開く）。
  function openBranch() {
    const hasPushPull = (ahead?.value || 0) > 0 || (behind?.value || 0) > 0;
    openWorkspacePane("branch", { expandBranch: hasPushPull });
  }

  // git未登録のベアターミナルではcwdを都度取得する（常時ポーリングはしない）。
  async function fetchCwd() {
    if (!tab.value.sessionId) return "";
    const { ok, data } = await apiGet(terminalSessionCwdPath(tab.value.sessionId));
    return ok ? (data?.cwd || "") : "";
  }

  // 非Gitワークスペースやワークスペース未紐付けのターミナルでは、ワークスペース
  // パスではなくセッションの実際のcwdを起点にFilesを開く。
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

  // ラベル/アイコンは固定表示にし、Add/Openどちらとして動くかはクリック時にcwdを見て判定する。
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
    await confirmOpenDevServer(p);
  }

  // 件数によらず常にDispatchタブを開く（個別詳細はDispatchタブの行から進む）。
  function openDispatch() {
    openWorkspacePane("dispatch");
  }

  // devserver-stopは「検出されなくなった」通知のみで遷移先が無いためdefaultへ。
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
