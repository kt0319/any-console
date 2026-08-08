import { emit } from "../app-bridge.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { terminalSessionCwdPath } from "../utils/endpoints.js";
import { resolveBareTerminalFilesDetail, resolveRegisterCurrentDirAction } from "../utils/bare-terminal-actions.js";
import { openExternal } from "../utils/open-external.js";
import { devServerUrl } from "../utils/preview-url.js";
import { copyText } from "../utils/clipboard.js";

// Info Pills（TerminalPane）のクリック時の遷移先。通常ピルとpeekピルの両方が
// 同じopenPane(key)を使う。
//
// @param {{
//   tab: import("vue").Ref<Record<string, any>>,
//   isGitRepo: import("vue").Ref<boolean>,
//   devServerEntry: import("vue").Ref<Record<string, any> | null>,
// }} options
export function useInfoPillActions({ tab, isGitRepo, devServerEntry }) {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();
  const { confirm } = useConfirm();

  // history/changes/branch/prs/actions はワークスペース詳細の同名ペインを開く
  // （pane名＝ピルのキー）。
  function openWorkspacePane(pane) {
    if (!tab.value.workspace) return;
    workspaceStore.selectedWorkspace = tab.value.workspace;
    emit("git:openFileModal", { pane });
  }

  // git 未登録（ワークスペース未紐付け）のベアターミナルでは、cwd を都度取得して
  // Files モーダル・ワークスペース登録に使う（常時ポーリングはせず必要時にのみ叩く）。
  async function fetchCwd() {
    if (!tab.value.sessionId) return "";
    const { ok, data } = await apiGet(terminalSessionCwdPath(tab.value.sessionId));
    return ok ? (data?.cwd || "") : "";
  }

  // 非Gitワークスペースに紐づいたターミナルでcdして未登録ディレクトリへ移動した
  // 場合や、ワークスペース未紐付けのベアターミナルの場合、Files はワークスペース
  // パスではなくセッションの実際のcwdを起点に開く（廃止済みWorkspaceStatusBarの
  // isPlainTerminal時の挙動を踏襲）。
  async function openBareTerminalFiles() {
    const cwd = tab.value.sessionId ? await fetchCwd() : "";
    emit("git:openFileModal", resolveBareTerminalFilesDetail(tab.value.sessionId, cwd));
  }

  // Gitワークスペースはワークスペース名から直接Filesペインを開く。
  // 非Git（ベアターミナル・非Git登録ワークスペース）はcwd起点のopenBareTerminalFilesへ。
  function openFiles() {
    if (isGitRepo.value && tab.value.workspace) {
      workspaceStore.selectedWorkspace = tab.value.workspace;
      emit("git:openFileModal", { pane: "files" });
    } else {
      openBareTerminalFiles();
    }
  }

  // 「Add」ボタンのラベル・アイコンは固定表示にする。実際にAdd/Openの
  // どちらとして動くかはクリック時にregisterCurrentDirがcwdを取得して
  // その場で判定する。
  async function registerCurrentDir() {
    if (!tab.value.sessionId) return;
    const cwd = await fetchCwd();
    const workspaces = /** @type {{name: string, path: string, icon?: string, icon_color?: string}[]} */ (
      workspaceStore.allWorkspaces
    );
    const action = resolveRegisterCurrentDirAction(cwd, workspaces);
    if (action.type === "openModal") {
      emit("workspace:openModal");
    } else if (action.type === "launch") {
      emit("terminal:launch", { workspace: action.workspace, icon: action.icon, iconColor: action.iconColor });
    } else {
      emit("workspace:openAdd", { initialPath: action.initialPath, attachSessionId: tab.value.sessionId, attachTabId: tab.value.id });
    }
  }

  async function openDevServer() {
    const p = devServerEntry.value;
    if (!p) return;
    const url = devServerUrl(p, location.hostname);
    const result = await confirm(`Open dev server preview at "${url}"?`, {
      ok: { label: "Open" },
      extra: { label: "Copy", value: "copy", icon: "mdi-content-copy" },
    });
    if (result === "copy") {
      await copyText(url);
      return;
    }
    if (!result) return;
    openExternal(url);
  }

  // 他のピル（history/changes/branch/prs/actions）と同じく、常にワークスペース
  // 詳細のDispatchタブを開く（件数によらず動作を揃える。1件だけの時の個別
  // 詳細へはDispatchタブの行から進む）。
  function openDispatch() {
    openWorkspacePane("dispatch");
  }

  // ピル/peekピルのキー → 遷移先。devserver-stopは「検出されなくなった」
  // という通知のみで開く対象が無いため対象外（default）。
  function openPane(key) {
    switch (key) {
      case "workspace":
      case "files":
        return openFiles();
      case "history":
      case "changes":
      case "branch":
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
