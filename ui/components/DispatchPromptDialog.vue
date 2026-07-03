<template>
  <BaseDialog :visible="visible" :z-index="10001" @dismiss="cancel">
    <div class="dispatch-prompt-box" role="dialog" aria-modal="true" aria-labelledby="dispatch-prompt-title">
      <h3 id="dispatch-prompt-title" class="dispatch-prompt-title">Run dispatch?</h3>

      <dl class="dispatch-prompt-meta">
        <template v-if="request?.workspace">
          <dt>Workspace</dt>
          <dd>{{ request.workspace }}</dd>
        </template>
        <template v-if="request?.worktree">
          <dt>Worktree</dt>
          <dd>{{ request.worktree }}</dd>
        </template>
        <template v-if="request?.job && request.job !== 'terminal'">
          <dt>Job</dt>
          <dd>{{ request.job }}</dd>
        </template>
      </dl>

      <template v-if="hasBranchField">
        <label class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">
            Branch
            <span v-if="branchStatusNote" class="dispatch-prompt-note">{{ branchStatusNote }}</span>
          </span>
          <input v-model="branch" type="text" autocomplete="off" spellcheck="false" />
        </label>

        <label class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">Base branch</span>
          <input v-model="baseBranch" type="text" autocomplete="off" spellcheck="false" placeholder="(current)" />
        </label>
      </template>

      <label class="dispatch-prompt-field">
        <span class="dispatch-prompt-label">Input</span>
        <textarea v-model="text" rows="4" autocomplete="off" spellcheck="false"></textarea>
      </label>

      <div class="dialog-buttons">
        <button type="button" class="dialog-btn dialog-btn-cancel" @click="cancel">Cancel</button>
        <button type="button" class="dialog-btn dialog-btn-ok" @click="approve">
          <span class="mdi mdi-play"></span> Run
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup>
import { computed } from "vue";
import BaseDialog from "./BaseDialog.vue";
import { useDispatchPrompt } from "../composables/useDispatchPrompt.js";

const { visible, request, branch, baseBranch, text, approve, cancel } = useDispatchPrompt();

const hasBranchField = computed(() => !!request.value?.branch || !!request.value?.worktree === false && !!request.value?.create_branch);

const branchStatusNote = computed(() => {
  const status = request.value?.branch_status;
  if (status === "current") return "(already current)";
  if (status === "exists") return "(checkout)";
  if (status === "missing") return request.value?.create_branch ? "(new branch)" : "(missing)";
  return "";
});
</script>

<style scoped>
.dispatch-prompt-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  width: 100%;
  max-width: 420px;
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dispatch-prompt-title {
  margin: 0 0 6px 0;
  font-size: 15px;
  color: var(--accent);
}
.dispatch-prompt-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 13px;
}
.dispatch-prompt-meta dt {
  color: var(--text-secondary);
}
.dispatch-prompt-meta dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
}
.dispatch-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.dispatch-prompt-label {
  color: var(--text-secondary);
  font-size: 12px;
}
.dispatch-prompt-note {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.dispatch-prompt-field input,
.dispatch-prompt-field textarea {
  padding: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}
.dispatch-prompt-field textarea {
  resize: vertical;
  font-family: monospace;
}
</style>
