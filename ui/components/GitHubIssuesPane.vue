<template>
  <div class="github-pane-wrapper pane-fill">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="issue-filter-bar">
          <button
            v-for="opt in ISSUE_FILTERS"
            :key="opt.value"
            type="button"
            class="issue-filter-btn"
            :class="{ active: issueFilter === opt.value }"
            @click="setIssueFilter(opt.value)"
          >{{ opt.label }}</button>
        </div>
        <div class="github-section-body">
          <div v-if="isLoading" class="github-loading loading-dots">Loading</div>
          <div v-else-if="error" class="github-error">{{ error }}</div>
          <div v-else-if="!items.length" class="text-muted-center">{{ emptyMessage }}</div>
          <a
            v-for="item in items"
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

const ISSUE_FILTERS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const emit = defineEmits(["count"]);
const { loadIssues } = useGitHub();
const issueFilter = ref("open");
const emptyMessage = computed(() => `No ${issueFilter.value === "all" ? "" : issueFilter.value + " "}issues`);
// loadIssues(filter) はローダー関数を返すファクトリ。useGitHubPane 自体は
// loaderFn を1つに固定するため、ラップして呼び出すたびに issueFilter.value を
// 読み直すことでフィルタ切替に対応する（reload()自体はuseGitHubPane側で提供）。
// countイベントはWorkspaceDetail.vueのIssuesタブの件数バッジ・表示条件（open issue数の
// 前提）に使われるため、open以外のフィルタ表示中は発火しない（closed/all選択中に
// バッジやタブの表示/非表示がその場で変わってしまうのを防ぐ）。
const { githubUrl, items, isLoading, error, reload } = useGitHubPane<GitHubIssue>(
  (stateRef) => loadIssues(issueFilter.value)(stateRef),
  { onLoaded: (v) => { if (issueFilter.value === "open") emit("count", v.length); } },
);

function setIssueFilter(value: string) {
  if (issueFilter.value === value) return;
  issueFilter.value = value;
  reload();
}

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
  gap: 6px;
  padding: 8px 12px 0;
}

.issue-filter-btn {
  flex: 1;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.issue-filter-btn.active {
  border-color: var(--accent);
  background: var(--accent-bg-12);
  color: var(--accent);
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
