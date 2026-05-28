<template>
  <div class="rss-pane-wrapper">
    <!-- ヘッダー -->
    <div class="rss-pane-header">
      <span class="rss-feed-title">{{ feedTitle }}</span>
      <button
        class="rss-header-btn"
        aria-label="Reload feed"
        data-tooltip="Reload feed"
        :disabled="itemsLoading"
        @click="reload"
      >
        <span class="mdi mdi-refresh" :class="{ 'rss-spinning': itemsLoading }"></span>
      </button>
      <button class="rss-header-btn rss-remove-btn" aria-label="Remove feed" data-tooltip="Remove feed" @click="onRemove">
        <span class="mdi mdi-delete-outline"></span>
      </button>
    </div>

    <!-- アイテムリスト -->
    <div class="modal-scroll-body">
      <div v-if="itemsLoading && items.length === 0" class="rss-status">Loading...</div>
      <div v-else-if="itemsError" class="rss-error-block">
        <span class="mdi mdi-alert-circle-outline rss-error-icon"></span>
        <span class="rss-error-msg">{{ itemsError }}</span>
        <button class="rss-error-reload" @click="reload">Retry</button>
      </div>
      <template v-else>
        <div
          v-for="item in items"
          :key="item.url + item.title"
          class="rss-item"
          @click="onItemClick(item)"
        >
          <span class="rss-item-title">{{ item.title }}</span>
          <span v-if="item.date" class="rss-item-date">{{ formatItemDate(item.date) }}</span>
        </div>
        <div v-if="items.length === 0" class="rss-status">No items</div>
      </template>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRSS, formatItemDate } from "../composables/useRSS.js";
import { RSS_AUTO_REFRESH_MS } from "../utils/constants.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const props = defineProps({
  feed: { type: Object, required: true },
});
const emit = defineEmits(["removed"]);

const { loadItems } = useRSS();
const allItems = ref([]);
const itemsLoading = ref(false);
const itemsError = ref("");

const items = computed(() => allItems.value.filter((i) => i.feed_id === props.feed.id));

const feedTitle = computed(() => {
  const first = allItems.value.find((i) => i.feed_id === props.feed.id);
  if (first?.feed_title) return first.feed_title;
  try { return new URL(props.feed.url).hostname; } catch { return props.feed.url; }
});

async function reload() {
  await loadItems(allItems, itemsLoading, itemsError);
}

function onItemClick(item) {
  if (item.url) bridgeEmit("terminal:url", { uri: item.url });
}

function onRemove() {
  emit("removed", props.feed.id);
}

let _timer = null;

onMounted(() => {
  reload();
  _timer = setInterval(reload, RSS_AUTO_REFRESH_MS);
});

onUnmounted(() => {
  clearInterval(_timer);
});

defineExpose({ reload });
</script>

<style scoped>
.rss-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rss-pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 40px;
}

.rss-feed-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.rss-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  flex-shrink: 0;
  min-height: 0;
  min-width: 0;
}

.rss-header-btn .mdi {
  font-size: 16px;
}

.rss-header-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (hover: hover) and (pointer: fine) {
  .rss-header-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .rss-remove-btn:hover:not(:disabled) {
    border-color: var(--error);
    color: var(--error);
  }
}

@keyframes rss-spin {
  to { transform: rotate(360deg); }
}

.rss-spinning {
  display: inline-block;
  animation: rss-spin 0.8s linear infinite;
}

.rss-error-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--error);
  font-size: 13px;
  text-align: center;
}

.rss-error-icon {
  font-size: 28px;
  opacity: 0.8;
}

.rss-error-msg {
  color: var(--error);
  word-break: break-all;
}

.rss-error-reload {
  margin-top: 4px;
  font-size: 12px;
  padding: 4px 16px;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  background: none;
  color: var(--error);
  cursor: pointer;
  min-height: 0;
  min-width: 0;
}

.rss-item {
  box-sizing: border-box;
  padding: 10px 12px;
  min-height: 44px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

@media (hover: hover) and (pointer: fine) {
  .rss-item:hover {
    background: var(--bg-secondary);
  }
}

.rss-item-title {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-width: 0;
}

.rss-item-date {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  white-space: nowrap;
}

.rss-status {
  padding: 12px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.rss-error {
  color: var(--error);
}

</style>
