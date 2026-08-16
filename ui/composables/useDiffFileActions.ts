import { computed, ref } from "vue";
import type { Ref } from "vue";

import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useToast } from "./useToast.ts";
import { copyText } from "../utils/clipboard.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { workspaceCommitMessagePath } from "../utils/endpoints.ts";

// useToast は未型付けのため、利用するメソッドの型をここで明示する。
type ToastFn = (message: string, opts?: { duration?: number, action?: string | object }) => void;

export function useDiffFileActions({ selectedCommit }: { selectedCommit: Ref<Record<string, any> | null> }) {
  const { apiGet } = useApi();
  const { getWorkspace } = useWorkspace();
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

  async function copySelectedCommitHash() {
    const entry = selectedCommit.value;
    if (!entry || entry.hash === "__dirty__") return;
    if (await copyText(entry.hash)) {
      toast.success(`Copied ${entry.hash}`);
    } else {
      toast.error("Failed to copy hash");
    }
  }

  // git log は一覧表示用に1行へ切り詰めたメッセージしか持たないため、
  // 「More」展開時にフルメッセージ（本文含む）をハッシュ単位でキャッシュ
  // しつつ取得する。未取得の間は一覧の1行メッセージへフォールバックする。
  const fullMessageCache = ref<{ hash: string, message: string } | null>(null);

  const selectedCommitFullMessage = computed(() => {
    const entry = selectedCommit.value;
    if (!entry) return "";
    const cached = fullMessageCache.value;
    if (cached && cached.hash === entry.fullHash) return cached.message;
    return entry.message;
  });

  async function loadSelectedCommitFullMessage() {
    const entry = selectedCommit.value;
    if (!entry || entry.hash === "__dirty__") return;
    if (fullMessageCache.value?.hash === entry.fullHash) return;
    const workspace = getWorkspace();
    if (!workspace) return;
    const { ok, data } = await apiGet(workspaceCommitMessagePath(workspace, entry.fullHash));
    if (ok && data?.message) {
      fullMessageCache.value = { hash: entry.fullHash, message: data.message };
    }
  }

  return {
    onDiffFileClick,
    copySelectedCommitHash,
    selectedCommitFullMessage,
    loadSelectedCommitFullMessage,
  };
}
