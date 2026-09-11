<template>
  <div class="github-pane-wrapper pane-fill">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="issue-filter-bar">
          <label class="issue-filter-check">
            <input type="checkbox" v-model="showOpen" />
            Open <span class="issue-filter-count">({{ openCount }})</span>
          </label>
          <label class="issue-filter-check">
            <input type="checkbox" v-model="showClosed" />
            Closed <span class="issue-filter-count">({{ closedCount }})</span>
          </label>
          <select v-model="sortBy" class="issue-sort-select" aria-label="Sort issues" data-tooltip="Sort issues">
            <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div class="github-section-body">
          <div v-if="isLoading" class="github-loading loading-dots">Loading</div>
          <div v-else-if="error" class="github-error">{{ error }}</div>
          <div v-else-if="!sortedItems.length" class="text-muted-center">{{ emptyMessage }}</div>
          <a
            v-for="item in sortedItems"
            :key="item.number"
            class="github-item issue-item"
            :href="githubUrl + '/issues/' + item.number"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="issue-item-main-row">
              <span class="mdi mdi-record-circle-outline issue-item-icon" :style="{ color: issueStateColor(item.state) }"></span>
              <span class="github-item-number">#{{ item.number }}</span>
              <span class="github-item-title text-ellipsis-flex">{{ item.title }}</span>
            </span>
            <span class="issue-item-meta-row">
              <span v-if="item.author" class="github-item-author">{{ item.author }}</span>
              <span v-if="item.createdAt" class="github-item-meta">{{ createdAgo(item.createdAt) }}</span>
              <span v-if="item.commentCount" class="issue-item-comments">
                <span class="mdi mdi-comment-outline"></span>{{ item.commentCount }}
              </span>
              <span v-if="item.labels?.length" class="github-labels">
                <span
                  v-for="label in item.labels"
                  :key="label.name"
                  class="github-label"
                  :style="labelStyle(label.color)"
                >{{ label.name }}</span>
              </span>
            </span>
          </a>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useGitHubPane } from "../composables/useGitHubPane.ts";
import { useGitHub, labelStyle, issueStateColor, type GitHubIssue } from "../composables/useGitHub.ts";
import { formatRelativeTime } from "../utils/format.ts";

const SORT_OPTIONS = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "comments-desc", label: "Most commented" },
];

const emit = defineEmits(["count"]);
const { loadIssues } = useGitHub();
// Open/Closedは排他ではなくチェックボックスで独立に切替える（両方ONで従来のAll相当
// になるため専用のAllオプションは不要）。gh issue list --state=all を1回だけ取得し、
// 件数・絞り込み・並び替えはすべてクライアント側の computed で行う（チェック切替の
// たびに再フェッチしない）。
const { githubUrl, items, isLoading, error, reload } = useGitHubPane<GitHubIssue>(
  loadIssues("all"),
  { onLoaded: (v) => emit("count", v.filter((i) => i.state === "open").length) },
);

const showOpen = ref(true);
const showClosed = ref(false);
const sortBy = ref("created-desc");

const openCount = computed(() => items.value.filter((i) => i.state === "open").length);
const closedCount = computed(() => items.value.filter((i) => i.state === "closed").length);

const filteredItems = computed(() => items.value.filter((i) =>
  (showOpen.value && i.state === "open") || (showClosed.value && i.state === "closed")));

const sortedItems = computed(() => {
  const list = [...filteredItems.value];
  switch (sortBy.value) {
    case "created-asc":
      return list.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    case "comments-desc":
      return list.sort((a, b) => b.commentCount - a.commentCount);
    default:
      return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }
});

const emptyMessage = computed(() => {
  if (!showOpen.value && !showClosed.value) return "Select Open or Closed to show issues";
  if (showOpen.value && showClosed.value) return "No issues";
  return showOpen.value ? "No open issues" : "No closed issues";
});

// createdAt は gh CLI からの ISO 8601 文字列。formatRelativeTime は
// epoch秒を取るため変換する。
function createdAgo(createdAt: string): string {
  return formatRelativeTime(new Date(createdAt).getTime() / 1000);
}

defineExpose({ reload });
</script>

<style scoped>
@import "../styles/github-pane.css";

.issue-filter-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 12px;
}

.issue-filter-check {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.issue-filter-check input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent, currentColor);
}

.issue-filter-count {
  color: var(--text-muted);
  font-weight: 400;
}

.issue-sort-select {
  margin-left: auto;
  min-height: 32px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

.issue-item {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

/* タイトル行は折返しさせず、タイトルを1行省略表示にする
   （flex-wrapを付けるとtext-ellipsis-flexの縮小が効かず横スクロールする）。 */
.issue-item-main-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.issue-item-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  padding-left: 20px;
}

.issue-item-icon {
  flex-shrink: 0;
  font-size: 15px;
}

.issue-item-comments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.issue-item-comments .mdi {
  font-size: 12px;
}
</style>
