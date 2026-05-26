import { ref } from "vue";

const visible = ref(false);
const message = ref("");
const extraButton = ref(null); // { label, value, icon?, desc? } | null
const okButton = ref(null);    // { label, icon?, danger?: boolean } | null
let _resolve = null;

function clear() {
  visible.value = false;
  extraButton.value = null;
  okButton.value = null;
}

export function useConfirm() {
  /**
   * @param {string} msg
   * @param {{
   *   ok?: { label: string, icon?: string, danger?: boolean },
   *   extra?: { label: string, value?: string, icon?: string, desc?: string },
   * }} [opts]
   * @returns {Promise<boolean | string>}
   */
  function confirm(msg, opts = {}) {
    if (_resolve) {
      _resolve(false);
      _resolve = null;
    }
    message.value = msg;
    extraButton.value = opts.extra
      ? {
          label: opts.extra.label,
          value: opts.extra.value ?? "extra",
          icon: opts.extra.icon || "",
          desc: opts.extra.desc || "",
        }
      : null;
    okButton.value = opts.ok
      ? { label: opts.ok.label, icon: opts.ok.icon || "", danger: !!opts.ok.danger }
      : null;
    visible.value = true;
    return new Promise((resolve) => { _resolve = resolve; });
  }
  function onOk() { clear(); _resolve?.(true); _resolve = null; }
  function onCancel() { clear(); _resolve?.(false); _resolve = null; }
  function onExtra() {
    const v = extraButton.value?.value || "extra";
    clear();
    _resolve?.(v);
    _resolve = null;
  }
  return { visible, message, extraButton, okButton, confirm, onOk, onCancel, onExtra };
}
