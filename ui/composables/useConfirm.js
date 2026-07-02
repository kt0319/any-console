import { ref } from "vue";
import { createPendingPromise } from "../utils/pending-promise.js";

const visible = ref(false);
const message = ref("");
const extraButton = ref(/** @type {{ label: string, value: string, icon: string, desc: string }|null} */ (null));
const extra2Button = ref(/** @type {{ label: string, value: string, icon: string, desc: string }|null} */ (null));
const okButton = ref(/** @type {{ label: string, icon: string, danger: boolean }|null} */ (null));
const pending = createPendingPromise();

function clear() {
  visible.value = false;
  extraButton.value = null;
  extra2Button.value = null;
  okButton.value = null;
}

export function useConfirm() {
  /**
   * @param {string} msg
   * @param {{
   *   ok?: { label: string, icon?: string, danger?: boolean },
   *   extra?: { label: string, value?: string, icon?: string, desc?: string },
   *   extra2?: { label: string, value?: string, icon?: string, desc?: string },
   * }} [opts]
   * @returns {Promise<boolean | string>}
   */
  function confirm(msg, opts = {}) {
    message.value = msg;
    extraButton.value = opts.extra
      ? {
          label: opts.extra.label,
          value: opts.extra.value ?? "extra",
          icon: opts.extra.icon || "",
          desc: opts.extra.desc || "",
        }
      : null;
    extra2Button.value = opts.extra2
      ? {
          label: opts.extra2.label,
          value: opts.extra2.value ?? "extra2",
          icon: opts.extra2.icon || "",
          desc: opts.extra2.desc || "",
        }
      : null;
    okButton.value = opts.ok
      ? { label: opts.ok.label, icon: opts.ok.icon || "", danger: !!opts.ok.danger }
      : null;
    visible.value = true;
    return pending.begin(false);
  }
  function onOk() { clear(); pending.settle(true); }
  function onCancel() { clear(); pending.settle(false); }
  function onExtra() {
    const v = extraButton.value?.value || "extra";
    clear();
    pending.settle(v);
  }
  function onExtra2() {
    const v = extra2Button.value?.value || "extra2";
    clear();
    pending.settle(v);
  }
  return { visible, message, extraButton, extra2Button, okButton, confirm, onOk, onCancel, onExtra, onExtra2 };
}
