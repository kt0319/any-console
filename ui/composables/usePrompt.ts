import { ref } from "vue";
import { createPendingPromise } from "../utils/pending-promise.ts";

const visible = ref(false);
const title = ref("");
const message = ref("");
const value = ref("");
const placeholder = ref("");
const confirmLabel = ref("OK");
const cancelLabel = ref("Cancel");
const inputType = ref("text");
const selectOnOpen = ref(true);
const pending = createPendingPromise();

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

type PromptOptions = {
  title?: string,
  message?: string,
  initialValue?: string,
  placeholder?: string,
  confirmLabel?: string,
  cancelLabel?: string,
  inputType?: string,
  selectOnOpen?: boolean,
};

export function usePrompt() {
  function prompt(options?: string | PromptOptions | null): Promise<string | null> {
    const next = typeof options === "string" ? { message: options } : (options || {});

    title.value = next.title || "";
    message.value = next.message || "";
    value.value = next.initialValue ?? "";
    placeholder.value = next.placeholder || "";
    confirmLabel.value = next.confirmLabel || "OK";
    cancelLabel.value = next.cancelLabel || "Cancel";
    inputType.value = next.inputType || "text";
    selectOnOpen.value = next.selectOnOpen !== false;
    visible.value = true;

    return pending.begin(null);
  }

  function onSubmit() {
    visible.value = false;
    pending.settle(value.value);
    resetState();
  }

  function onCancel() {
    visible.value = false;
    pending.settle(null);
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
