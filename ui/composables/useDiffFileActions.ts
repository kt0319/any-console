import { computed } from "vue";
import type { Ref } from "vue";

import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useToast } from "./useToast.ts";
import { useConfirm } from "./useConfirm.ts";
import { copyText } from "../utils/clipboard.ts";
import { emit as bridgeEmit } from "../app-bridge.js";
import { workspaceCommitMessagePath } from "../utils/endpoints.ts";

// useToast は未型付けのため、利用するメソッドの型をここで明示する。
type ToastFn = (message: string, opts?: { duration?: number, action?: string | object }) => void;

export function useDiffFileActions({ selectedCommit }: { selectedCommit: Ref<Record<string, any> | null> }) {
  const { apiGet } = useApi();
  const { getWorkspace } = useWorkspace();
  const { confirm } = useConfirm();
  const toast: Record<"success" | "error" | "info" | "warning", ToastFn> = useToast();

  const isWorkingTreeDiff = computed(() => selectedCommit.value?.hash === "__dirty__");

  function onDiffFileClick(file: { path: string }) {
    selectCommitDiffFile(file);
  }

  function selectCommitDiffFile(file: { path: string }) {
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
