import { ref } from "vue";
import { createPendingPromise } from "../utils/pending-promise.ts";

const visible = ref(false);
const message = ref("");
const extraButton = ref(/** @type {{ label: string, value: string, icon: string, desc: string }|null} */ (null));
const extra2Button = ref(/** @type {{ label: string, value: string, icon: string, desc: string }|null} */ (null));
const okButton = ref(/** @type {{ label: string, icon: string, danger: boolean }|null} */ (null));
const busy = ref(false);
const busyLabel = ref("");
const pending = createPendingPromise();
/** @type {(() => Promise<void>) | null} OK 押下後に実行する非同期処理。指定時はダイアログを閉じずに busy 表示にする。 */
let runOnOk = null;

function clear() {
  visible.value = false;
  extraButton.value = null;
  extra2Button.value = null;
  okButton.value = null;
  busy.value = false;
  busyLabel.value = "";
  runOnOk = null;
}

export function useConfirm() {
  /**
   * @param {string} msg
   * @param {{
   *   ok?: { label: string, icon?: string, danger?: boolean },
   *   extra?: { label: string, value?: string, icon?: string, desc?: string },
   *   extra2?: { label: string, value?: string, icon?: string, desc?: string },
   *   run?: () => Promise<void>,
   *   busyLabel?: string,
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
    runOnOk = opts.run || null;
    busyLabel.value = opts.busyLabel || "";
    visible.value = true;
    return pending.begin(false);
  }
  async function onOk() {
    if (runOnOk) {
      const run = runOnOk;
      busy.value = true;
      try {
        await run();
      } finally {
        busy.value = false;
      }
    }
    clear();
    pending.settle(true);
  }
  function onCancel() {
    if (busy.value) return;
    clear();
    pending.settle(false);
  }
  function onExtra() {
    if (busy.value) return;
    const v = extraButton.value?.value || "extra";
    clear();
    pending.settle(v);
  }
  function onExtra2() {
    if (busy.value) return;
    const v = extra2Button.value?.value || "extra2";
    clear();
    pending.settle(v);
  }
  return {
    visible, message, extraButton, extra2Button, okButton, busy, busyLabel,
    confirm, onOk, onCancel, onExtra, onExtra2,
  };
}
