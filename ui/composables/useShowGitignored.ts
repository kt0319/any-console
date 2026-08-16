import type { Ref } from "vue";
import { ref, watch } from "vue";
import { LS_PREFIX_WS_META } from "../utils/constants.ts";
import { safeFlagLoad, safeFlagSave } from "../utils/storage.ts";

const SHOW_GITIGNORED_KEY_PREFIX = LS_PREFIX_WS_META + "show_gitignored_";

function loadFlag(wsName: string | null | undefined) {
  if (!wsName) return false;
  return safeFlagLoad(SHOW_GITIGNORED_KEY_PREFIX + wsName);
}

function saveFlag(wsName: string | null | undefined, value: boolean) {
  if (!wsName) return;
  safeFlagSave(SHOW_GITIGNORED_KEY_PREFIX + wsName, value);
}

export function useShowGitignored(workspaceNameRef: Ref<string | null>) {
  const showGitignored = ref(loadFlag(workspaceNameRef.value));

  watch(workspaceNameRef, (wsName) => {
    showGitignored.value = loadFlag(wsName);
  });

  watch(showGitignored, (value) => {
    saveFlag(workspaceNameRef.value, value);
  });

  return { showGitignored };
}
