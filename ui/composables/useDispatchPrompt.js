import { computed, ref } from "vue";
import { createPendingPromise } from "../utils/pending-promise.js";

// Session select の「新規セッション」を表す特別値。
export const NEW_SESSION_VALUE = "__new__";

/**
 * @typedef {{
 *   workspace?: string,
 *   worktree?: string|null,
 *   job?: string,
 *   branch?: string|null,
 *   branch_status?: string,
 *   base_branch?: string|null,
 *   create_branch?: boolean,
 *   text?: string,
 *   effective_workspace?: string,
 *   existing_session_id?: string|null,
 * }} DispatchRequestPayload
 */

// dispatch 承認モーダルの状態（単一ダイアログ）。
const visible = ref(false);
/** @type {import("vue").Ref<DispatchRequestPayload|null>} */
const request = ref(null);
const branch = ref("");
const baseBranch = ref("");
const text = ref("");
const selectedWorkspace = ref("");
const selectedJob = ref("terminal");
const selectedSessionId = ref(NEW_SESSION_VALUE);
const isNewSession = computed(() => selectedSessionId.value === NEW_SESSION_VALUE);
const selectedCreateBranch = ref(true);
const pending = createPendingPromise();
/** @type {import("vue").Ref<string|null>} */
const currentId = ref(null);

function reset() {
  visible.value = false;
  request.value = null;
  branch.value = "";
  baseBranch.value = "";
  text.value = "";
  selectedWorkspace.value = "";
  selectedJob.value = "terminal";
  selectedSessionId.value = NEW_SESSION_VALUE;
  selectedCreateBranch.value = true;
  currentId.value = null;
}

export function useDispatchPrompt() {
  /**
   * ダイアログを開き、承認(approved: true, overrides) / 拒否(approved: false) を待つ。
   * @param {object} req dispatch リクエスト（サーバから流れてきた payload）
   * @returns {Promise<{approved: boolean, overrides: object}>}
   */
  function open(req, id = null) {
    request.value = req || {};
    branch.value = req?.branch || "";
    baseBranch.value = req?.base_branch || "";
    text.value = req?.text || "";
    selectedWorkspace.value = req?.workspace || "";
    selectedJob.value = req?.job || "terminal";
    selectedSessionId.value = req?.existing_session_id || NEW_SESSION_VALUE;
    selectedCreateBranch.value = !!req?.create_branch;
    currentId.value = id;
    visible.value = true;
    return pending.begin({ approved: false, overrides: {} });
  }

  function approve() {
    const orig = request.value || {};
    const origIsNew = !orig.existing_session_id;
    const origCreateBranch = !!orig.create_branch;
    const overrides = {
      workspace: selectedWorkspace.value !== (orig.workspace || "") ? selectedWorkspace.value : null,
      branch: branch.value !== (orig.branch || "") ? branch.value : null,
      base_branch: baseBranch.value !== (orig.base_branch || "") ? baseBranch.value : null,
      text: text.value !== (orig.text || "") ? text.value : null,
      job: selectedJob.value !== (orig.job || "terminal") ? selectedJob.value : null,
      match: isNewSession.value !== origIsNew ? (isNewSession.value ? "none" : "any") : null,
      session_id: !isNewSession.value && selectedSessionId.value !== (orig.existing_session_id || null) ? selectedSessionId.value : null,
      create_branch: selectedCreateBranch.value !== origCreateBranch ? selectedCreateBranch.value : null,
    };
    reset();
    pending.settle({ approved: true, overrides });
  }

  function cancel() {
    reset();
    pending.settle({ approved: false, overrides: {} });
  }

  function dismissById(id) {
    if (currentId.value === id && visible.value) cancel();
  }

  return { visible, request, branch, baseBranch, text, selectedWorkspace, selectedJob, selectedSessionId, isNewSession, selectedCreateBranch, open, approve, cancel, dismissById };
}
