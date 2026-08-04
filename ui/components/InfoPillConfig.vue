<template>
  <div class="modal-scroll-body">
    <div v-if="!infoPillConfig.loaded" class="text-muted-center">Loading...</div>
    <template v-else>
      <label
        v-for="(item, idx) in orderedToggles"
        :key="item.field"
        class="settings-item settings-toggle pill-toggle-row"
        :class="{
          'drag-source': dragFromIdx === idx,
          'drag-over-above': dragOverIdx === idx && dragFromIdx > idx,
          'drag-over-below': dragOverIdx === idx && dragFromIdx < idx,
        }"
      >
        <span class="drag-handle" aria-hidden="true" @pointerdown.prevent="onDragStart($event, idx)">
          <span class="mdi mdi-drag-vertical"></span>
        </span>
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
import { inject, computed } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
import { useListDragSort } from "../composables/useListDragSort.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Info Pills";

const infoPillConfig = useInfoPillConfigStore();
if (!infoPillConfig.loaded) infoPillConfig.load();

// ラベルはピル本体のツールチップ文言（TerminalPane.vue）に揃える。
// 表示順は infoPillConfig.order（ドラッグハンドルで並び替え可能。
// ワークスペース一覧・Tabs & Sessionsと同じuseListDragSort）に従う。
const TOGGLES = [
  {
    field: "files",
    label: "Workspace",
    note: "Shows the workspace's own icon (with a dirty-changes dot when applicable) and opens the files browser. Shown for any terminal with an active session, Git or not.",
  },
  {
    field: "history",
    label: "History",
    note: "Browse commit history. Only shown for Git workspaces. Hovering shows the last commit message.",
  },
  {
    field: "changes",
    label: "Changes",
    note: "Uncommitted file/insertion/deletion counts. Only shown while the workspace has uncommitted changes.",
  },
  {
    field: "branch",
    label: "Branches",
    note: "Current branch name, with push/pull counts badged on top when the branch has commits to push or pull.",
  },
  {
    field: "prs",
    label: "GitHub PRs",
    note: "Only shown when the current branch has an open GitHub pull request.",
  },
  {
    field: "actions",
    label: "GitHub Actions",
    note: "Only shown while the current branch's latest GitHub Actions run is running or failed (successful/other completed runs stay hidden).",
  },
  {
    field: "devserver",
    label: "Dev Server",
    note: "Only shown when a dev server is auto-detected listening in this workspace's directory.",
  },
  {
    field: "add",
    label: "Add / Open",
    note: "Register or open the current directory as a workspace. Only shown for terminals not yet tied to a Git workspace.",
  },
  {
    field: "dispatch",
    label: "Dispatch",
    note: "Only shown when a /dispatch API request is waiting for approval against this workspace. Tapping it opens the request directly if there's just one, or the full queue if there are several.",
  },
];

const orderedToggles = computed(() =>
  infoPillConfig.order.map((field) => TOGGLES.find((t) => t.field === field)).filter(Boolean),
);

const { dragFromIdx, dragOverIdx, onDragStart } = useListDragSort({
  rowSelector: ".pill-toggle-row",
  onReorder: (fromIdx, toIdx) => infoPillConfig.reorder(fromIdx, toIdx),
});

function setField(field, value) {
  infoPillConfig[field] = value;
  infoPillConfig.save();
}
</script>

<style scoped>
/* .settings-toggle（settings-form.css）は justify-content:space-between の
   2要素（checkbox + copy）前提のため、先頭にdrag-handleを足すと間延びする。
   ここだけ通常の並び順（handle→checkbox→copy）に上書きする。 */
.pill-toggle-row {
  justify-content: flex-start;
}
</style>
