import { ref } from "vue";

const visible = ref(false);
const title = ref("");
const message = ref("");
const value = ref("");
const placeholder = ref("");
const confirmLabel = ref("OK");
const cancelLabel = ref("Cancel");
const inputType = ref("text");
const selectOnOpen = ref(true);
let _resolve = null;

function resetState() {
  title.value = "";
  message.value = "";
  value.value = "";
  placeholder.value = "";
  confirmLabel.value = "OK";
  cancelLabel.value = "Cancel";
  inputType.value = "text";
  selectOnOpen.value = true;
}

export function usePrompt() {
  function prompt(options) {
    const next = typeof options === "string" ? { message: options } : (options || {});

    if (_resolve) {
      _resolve(null);
      _resolve = null;
    }

    title.value = next.title || "";
    message.value = next.message || "";
    value.value = next.initialValue ?? "";
    placeholder.value = next.placeholder || "";
    confirmLabel.value = next.confirmLabel || "OK";
    cancelLabel.value = next.cancelLabel || "Cancel";
    inputType.value = next.inputType || "text";
    selectOnOpen.value = next.selectOnOpen !== false;
    visible.value = true;

    return new Promise((resolve) => {
      _resolve = resolve;
    });
  }

  function onSubmit() {
    visible.value = false;
    const resolve = _resolve;
    _resolve = null;
    resolve?.(value.value);
    resetState();
  }

  function onCancel() {
    visible.value = false;
    const resolve = _resolve;
    _resolve = null;
    resolve?.(null);
    resetState();
  }

  return {
    visible,
    title,
    message,
    value,
    placeholder,
    confirmLabel,
    cancelLabel,
    inputType,
    selectOnOpen,
    prompt,
    onSubmit,
    onCancel,
  };
}
