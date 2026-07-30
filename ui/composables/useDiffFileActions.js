import { computed } from "vue";

import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { useToast } from "./useToast.js";
import { useConfirm } from "./useConfirm.js";
import { copyText } from "../utils/clipboard.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { workspaceCommitMessagePath } from "../utils/endpoints.js";

export function useDiffFileActions({ selectedCommit }) {
  const { apiGet } = useApi();
  const { getWorkspace } = useWorkspace();
  const { confirm } = useConfirm();
  const toast = useToast();

  const isWorkingTreeDiff = computed(() => selectedCommit.value?.hash === "__dirty__");

  function onDiffFileClick(file) {
    selectCommitDiffFile(file);
  }

  function selectCommitDiffFile(file) {
    bridgeEmit("git:selectDiffFile", {
      path: file.path,
      isWorkingTree: isWorkingTreeDiff.value,
      commitHash: selectedCommit.value?.fullHash || "",
    });
  }

  async function showSelectedCommitMessage() {
    const entry = selectedCommit.value;
    if (!entry) return;
    if (entry.hash === "__dirty__") return;
    const workspace = getWorkspace();
    if (!workspace) return;
    const { ok, data } = await apiGet(workspaceCommitMessagePath(workspace, entry.fullHash));
    const msg = ok && data?.message ? data.message : entry.message;
    const result = await confirm(`${entry.hash}\n\n${msg}`, {
      extra: { label: "Copy hash", value: "copy", icon: "mdi-content-copy" },
    });
    if (result === "copy") {
      if (await copyText(entry.hash)) {
        toast.success(`Copied ${entry.hash}`);
      } else {
        toast.error("Failed to copy hash");
      }
    }
  }

  return {
    onDiffFileClick,
    showSelectedCommitMessage,
  };
}
