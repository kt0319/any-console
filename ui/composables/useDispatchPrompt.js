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
 * }} DispatchRequestPayload
 */

// dispatch 承認モーダルの状態（単一ダイアログ）。
const visible = ref(false);
/** @type {import("vue").Ref<DispatchRequestPayload|null>} */
const request = ref(null);
const branch = ref("");
const baseBranch = ref("");
const text = ref("");
const pending = createPendingPromise();
/** @type {import("vue").Ref<string|null>} */
const currentId = ref(null);

function reset() {
  visible.value = false;
  request.value = null;
  branch.value = "";
  baseBranch.value = "";
  text.value = "";
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
    currentId.value = id;
    visible.value = true;
    return pending.begin({ approved: false, overrides: {} });
  }

  function approve() {
    const overrides = {
      branch: branch.value !== (request.value?.branch || "") ? branch.value : null,
      base_branch: baseBranch.value !== (request.value?.base_branch || "") ? baseBranch.value : null,
      text: text.value !== (request.value?.text || "") ? text.value : null,
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

  return { visible, request, branch, baseBranch, text, open, approve, cancel, dismissById };
}
