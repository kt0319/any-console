<template>
  <div class="diff-commit-form-wrapper">
    <textarea
      ref="textareaEl"
      v-model="commitMessage"
      class="diff-commit-textarea"
      placeholder="Commit message"
      autocomplete="off"
      rows="1"
    ></textarea>
    <div v-if="error" class="form-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "../composables/useApi.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { buildActionResult } from "../utils/git-remote.ts";
import { emit } from "../app-bridge.ts";
import { COMMIT_MESSAGE_MAX_ROWS, extractApiError } from "../utils/constants.ts";
import { resolveAutoGrow } from "../utils/textarea-autogrow.ts";

const { apiCommand, wsEndpoint } = useApi();
const { confirm } = useConfirm();
const workspaceStore = useWorkspaceStore();

const commitMessage = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);

function fitTextareaHeight() {
  const el = textareaEl.value;
  if (!el) return;
  const style = getComputedStyle(el);
  const px = (value: string) => parseFloat(value) || 0;
  el.style.height = "auto";
  const { heightPx, scrollable } = resolveAutoGrow({
    scrollHeight: el.scrollHeight,
    rowHeight: px(style.lineHeight),
    paddingPx: px(style.paddingTop) + px(style.paddingBottom),
    borderPx: px(style.borderTopWidth) + px(style.borderBottomWidth),
    maxRows: COMMIT_MESSAGE_MAX_ROWS,
  });
  el.style.height = `${heightPx}px`;
  el.style.overflowY = scrollable ? "auto" : "hidden";
}

watch(commitMessage, () => nextTick(fitTextareaHeight));
onMounted(fitTextareaHeight);
const error = ref("");
const submitting = ref(false);

async function submit() {
  const msg = commitMessage.value.trim();
  if (!msg || submitting.value) return;

  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) {
    error.value = "No workspace selected";
    return;
  }

  if (!(await confirm(`Commit with message:\n\n"${msg}"`))) return;

  submitting.value = true;
  error.value = "";

  try {
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "commit"), { message: msg });
    if (ok) {
      emit("git:remoteDone", { wsName: workspace, result: buildActionResult("Committed", msg.split("\n")[0]) });
      commitMessage.value = "";
      emit("git:commitDone");
    } else {
      error.value = extractApiError(data, "Commit failed");
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    submitting.value = false;
  }
}

defineExpose({ open: () => {}, close: () => {}, submit, submitting, commitMessage });
</script>

<style scoped>
.diff-commit-form-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 10px 4px;
  flex-shrink: 0;
}

.diff-commit-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;
  resize: none;
  overflow-y: hidden;
  outline: none;
  min-height: 36px;
}

.diff-commit-textarea::placeholder {
  color: var(--text-muted);
}

.form-error {
  color: var(--error);
  font-size: 12px;
}
</style>
