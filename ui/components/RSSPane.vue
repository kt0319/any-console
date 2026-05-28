<template>
  <div class="rss-pane-wrapper">
    <!-- ヘッダー -->
    <div class="rss-pane-header">
      <span class="rss-feed-title">{{ feedTitle }}</span>
      <button class="rss-remove-btn" aria-label="Remove feed" data-tooltip="Remove feed" @click="onRemove">
        <span class="mdi mdi-delete-outline"></span>
        <span class="rss-remove-label">Remove</span>
      </button>
    </div>

    <!-- アイテムリスト -->
    <div class="modal-scroll-body">
      <div v-if="itemsLoading" class="rss-status">Loading...</div>
      <div v-else-if="itemsError" class="rss-status rss-error">{{ itemsError }}</div>
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

    <!-- アイテムアクションモーダル -->
    <div v-if="activeItem" class="rss-action-overlay" @click.self="activeItem = null">
      <div class="rss-action-dialog">
        <div class="rss-action-title">{{ activeItem.title }}</div>
        <div class="rss-action-url">{{ activeItem.url }}</div>
        <div class="rss-action-buttons">
          <button class="rss-action-btn" @click="doOpen">
            <span class="mdi mdi-open-in-new"></span>Open
          </button>
          <button class="rss-action-btn" @click="doCopy">
            <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>{{ copied ? "Copied!" : "Copy URL" }}
          </button>
          <button class="rss-action-btn rss-action-btn-cancel" @click="activeItem = null">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRSS, formatItemDate } from "../composables/useRSS.js";
import { RSS_AUTO_REFRESH_MS } from "../utils/constants.js";

const props = defineProps({
  feed: { type: Object, required: true },
});
const emit = defineEmits(["removed"]);

const { loadItems } = useRSS();
const allItems = ref([]);
const itemsLoading = ref(false);
const itemsError = ref("");
const activeItem = ref(null);
const copied = ref(false);

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
  activeItem.value = item;
  copied.value = false;
}

function doOpen() {
  if (activeItem.value?.url) window.open(activeItem.value.url, "_blank", "noopener,noreferrer");
  activeItem.value = null;
}

async function doCopy() {
  if (!activeItem.value?.url) return;
  try {
    await navigator.clipboard.writeText(activeItem.value.url);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    copied.value = false;
  }
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
  position: relative;
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

.rss-remove-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  flex-shrink: 0;
}

.rss-remove-btn .mdi {
  font-size: 14px;
}

@media (hover: hover) and (pointer: fine) {
  .rss-remove-btn:hover {
    border-color: var(--error);
    color: var(--error);
  }
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

/* アクションモーダル */
.rss-action-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 10;
  padding: 12px;
  box-sizing: border-box;
}

.rss-action-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rss-action-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.rss-action-url {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rss-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.rss-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.rss-action-btn .mdi {
  font-size: 16px;
}

.rss-action-btn-cancel {
  color: var(--text-muted);
  margin-top: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .rss-action-btn:hover {
    background: var(--bg-tertiary);
  }
}
</style>
