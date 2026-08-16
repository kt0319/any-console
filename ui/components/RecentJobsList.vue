<template>
  <div class="recent-jobs-list">
    <button
      v-for="recent in visibleRecentJobs"
      :key="recent.key"
      type="button"
      class="recent-jobs-item hover-bg"
      :class="{ 'is-detached-tab': recent.jobDetached }"
      @click="onItemClick(recent)"
    >
      <span class="recent-jobs-item-icons">
        <span v-if="recent.wsIcon" v-html="renderIconStr(recent.wsIcon, recent.wsIconColor, 16)"></span>
        <span v-if="recent.jobIcon" v-html="renderIconStr(recent.jobIcon, recent.jobIconColor, 16)"></span>
      </span>
      <span class="recent-jobs-item-label">
        <span class="recent-jobs-item-ws">{{ recent.workspace }}</span>
        <span v-if="recent.jobLabel || recent.jobName" class="recent-jobs-item-sep">|</span>
        <span class="recent-jobs-item-name">{{ recent.jobLabel || recent.jobName }}</span>
      </span>
      <span
        v-if="!editMode"
        class="recent-jobs-item-pin hover-bg-text"
        :class="{ pinned: recent.pinned }"
        role="button"
        tabindex="0"
        :aria-label="recent.pinned ? 'Unpin' : 'Pin'"
        :data-tooltip="recent.pinned ? 'Unpin' : 'Pin'"
        @click.stop="togglePin(recent.key)"
        @keydown.enter.space.stop.prevent="togglePin(recent.key)"
      ><span class="mdi" :class="recent.pinned ? 'mdi-pin' : 'mdi-pin-outline'"></span></span>
      <span
        v-else
        class="recent-jobs-item-pin recent-jobs-item-delete hover-bg-text"
        role="button"
        tabindex="0"
        aria-label="Remove recent job"
        data-tooltip="Remove recent job"
        @click.stop="removeRecent(recent)"
        @keydown.enter.space.stop.prevent="removeRecent(recent)"
      ><span class="mdi mdi-delete-outline"></span></span>
    </button>
    <button
      v-if="allowExpand && hasUnpinnedRecentJobs"
      type="button"
      class="recent-jobs-more hover-bg-text"
      @click="showAll = !showAll"
    >
      <span class="mdi" :class="showAll ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
      {{ showAll ? 'Less' : 'More' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRecentJobs } from "../composables/useRecentJobs.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { RECENT_JOBS_MAX } from "../utils/constants.ts";

const props = defineProps({
  allowExpand: { type: Boolean, default: true },
  editMode: { type: Boolean, default: false },
});

const { recentJobs, runRecentJob, togglePin, removeRecentJob } = useRecentJobs();
const { confirm } = useConfirm();

// 編集モード中は行本体のクリックでジョブを起動しない（削除アイコンを
// 少し外してタップしただけでジョブが走ってしまうのを防ぐ）。
function onItemClick(recent: (typeof recentJobs.value)[number]) {
  if (props.editMode) return;
  runRecentJob(recent);
}

async function removeRecent(recent: (typeof recentJobs.value)[number]) {
  const label = recent.jobLabel || recent.jobName;
  if (!await confirm(`Remove "${recent.workspace} | ${label}" from Recent Jobs?`)) return;
  await removeRecentJob(recent.key);
}

// 初期表示はピン留めのみ。非ピン留めは「More」で展開する。
// allowExpand=falseの場合はMore/Lessを出さず、常に全件（上限RECENT_JOBS_MAX件）表示する。
const showAll = ref(false);
const hasUnpinnedRecentJobs = computed(() => recentJobs.value.some((j) => !j.pinned));
const visibleRecentJobs = computed(() => {
  if (!props.allowExpand) return recentJobs.value.slice(0, RECENT_JOBS_MAX);
  return showAll.value ? recentJobs.value : recentJobs.value.filter((j) => j.pinned);
});
</script>

<style scoped>
.recent-jobs-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
}

.recent-jobs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 12px 4px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
}


.recent-jobs-item.is-detached-tab {
  opacity: 0.6;
}

.recent-jobs-item-icons {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  width: 20px;
  margin-right: 4px;
  justify-content: center;
}

.recent-jobs-item-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-jobs-item-ws {
  color: var(--text-muted);
}

.recent-jobs-item-sep {
  color: var(--border);
  flex-shrink: 0;
}

.recent-jobs-item-name {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-jobs-item-pin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  margin-left: 4px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.recent-jobs-item-pin.pinned {
  color: var(--accent);
}

.recent-jobs-item-delete {
  color: var(--error);
  border-color: var(--error);
}

@media (hover: hover) and (pointer: fine) {
  .recent-jobs-item-delete:hover {
    background: var(--error-bg-20, rgba(255, 85, 114, 0.15));
  }
}


.recent-jobs-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 36px;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

</style>
