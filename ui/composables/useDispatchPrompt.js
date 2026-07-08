import { ref } from "vue";
import { createPendingPromise } from "../utils/pending-promise.js";

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
const selectedJob = ref("terminal");
const selectedMatch = ref("existing");
const pending = createPendingPromise();
/** @type {import("vue").Ref<string|null>} */
const currentId = ref(null);

function reset() {
  visible.value = false;
  request.value = null;
  branch.value = "";
  baseBranch.value = "";
  text.value = "";
  selectedJob.value = "terminal";
  selectedMatch.value = "existing";
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
    selectedJob.value = req?.job || "terminal";
    selectedMatch.value = req?.existing_session_id ? "existing" : "new";
    currentId.value = id;
    visible.value = true;
    return pending.begin({ approved: false, overrides: {} });
  }

  function approve() {
    const orig = request.value || {};
    const origMatch = orig.existing_session_id ? "existing" : "new";
    const overrides = {
      branch: branch.value !== (orig.branch || "") ? branch.value : null,
      base_branch: baseBranch.value !== (orig.base_branch || "") ? baseBranch.value : null,
      text: text.value !== (orig.text || "") ? text.value : null,
      job: selectedJob.value !== (orig.job || "terminal") ? selectedJob.value : null,
      match: selectedMatch.value !== origMatch ? (selectedMatch.value === "new" ? "none" : "any") : null,
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

  return { visible, request, branch, baseBranch, text, selectedJob, selectedMatch, open, approve, cancel, dismissById };
}
