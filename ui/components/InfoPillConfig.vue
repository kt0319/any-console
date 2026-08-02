<template>
  <div class="modal-scroll-body">
    <div v-if="!infoPillConfig.loaded" class="text-muted-center">Loading...</div>
    <template v-else>
      <label v-for="item in TOGGLES" :key="item.field" class="settings-item settings-toggle">
        <input type="checkbox" :checked="infoPillConfig[item.field]" @change="setField(item.field, $event.target.checked)" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">{{ item.label }}</span>
          <span class="settings-note">{{ item.note }}</span>
        </div>
      </label>
    </template>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Info Pills";

const infoPillConfig = useInfoPillConfigStore();
if (!infoPillConfig.loaded) infoPillConfig.load();

// ラベルはピル本体のツールチップ文言（TerminalPane.vue）に揃える。
const TOGGLES = [
  { field: "workspace", label: "Workspace name", note: "Show the workspace/tab name label on the pill." },
  { field: "branch", label: "Branches", note: "Show the current branch button." },
  { field: "history", label: "History", note: "Show the commit history button." },
  { field: "changes", label: "Changes", note: "Show the uncommitted changes button." },
  { field: "pull", label: "Pull", note: "Show the pull (behind commits) button." },
  { field: "push", label: "Push", note: "Show the push / set upstream buttons." },
  { field: "devserver", label: "Dev Server", note: "Show the detected dev server button." },
  { field: "files", label: "Files", note: "Show the files browser button." },
  { field: "add", label: "Add / Open", note: "Show the add-or-open-workspace button for non-Git terminals." },
];

function setField(field, value) {
  infoPillConfig[field] = value;
  infoPillConfig.save();
}
</script>
