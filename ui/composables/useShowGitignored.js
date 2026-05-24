import { ref, watch } from "vue";
import { LS_PREFIX_WS_META } from "../utils/constants.js";

const SHOW_GITIGNORED_KEY_PREFIX = LS_PREFIX_WS_META + "show_gitignored_";

function loadFlag(wsName) {
  if (!wsName) return false;
  try {
    return localStorage.getItem(SHOW_GITIGNORED_KEY_PREFIX + wsName) === "1";
  } catch {
    return false;
  }
}

function saveFlag(wsName, value) {
  if (!wsName) return;
  try {
    if (value) localStorage.setItem(SHOW_GITIGNORED_KEY_PREFIX + wsName, "1");
    else localStorage.removeItem(SHOW_GITIGNORED_KEY_PREFIX + wsName);
  } catch {
    /* quota — ignore */
  }
}

export function useShowGitignored(workspaceNameRef) {
  const showGitignored = ref(loadFlag(workspaceNameRef.value));

  watch(workspaceNameRef, (wsName) => {
    showGitignored.value = loadFlag(wsName);
  });

  watch(showGitignored, (value) => {
    saveFlag(workspaceNameRef.value, value);
  });

  return { showGitignored };
}
