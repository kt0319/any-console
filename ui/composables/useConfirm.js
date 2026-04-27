import { ref } from "vue";

const visible = ref(false);
const message = ref("");
let _resolve = null;

export function useConfirm() {
  function confirm(msg) {
    message.value = msg;
    visible.value = true;
    return new Promise((resolve) => { _resolve = resolve; });
  }
  function onOk() { visible.value = false; _resolve?.(true); _resolve = null; }
  function onCancel() { visible.value = false; _resolve?.(false); _resolve = null; }
  return { visible, message, confirm, onOk, onCancel };
}
