import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";
import { useRSS, isToday } from "./useRSS.js";
import { RSS_AUTO_REFRESH_MS } from "../utils/constants.js";

/**
 * WorkspaceDetail の RSS タブ関連の state とロジックをまとめた composable。
 * フィード一覧・新着件数のバックグラウンド更新・追加/編集ダイアログの状態を扱う。
 *
 * @param {object} deps
 * @param {import("vue").Ref<string>} deps.activePane アクティブなペインのキー
 * @param {(key: string) => void} deps.switchPane ペイン切替（親が提供）
 * @param {(message: string) => Promise<boolean>} deps.confirm 確認ダイアログ（useConfirm の confirm）
 */
export function useWorkspaceRssTabs({ activePane, switchPane, confirm }) {
  const { loadFeeds, loadItems, addFeed, removeFeed, updateFeed } = useRSS();

  const rssFeeds = ref([]);
  const rssNewItemCounts = ref({});
  const rssAddingFeed = ref(false);
  const rssEditingFeed = ref(null);
  const rssNewFeedUrl = ref("");
  const rssNewFeedTitle = ref("");
  const rssAddError = ref("");
  const rssAddSubmitting = ref(false);

  function rssLabel(feed) {
    if (feed.title) return feed.title;
    try { return new URL(feed.url).hostname; } catch { return feed.url; }
  }

  const currentRssFeed = computed(() => {
    if (!activePane.value.startsWith("rss-")) return null;
    const id = activePane.value.slice(4);
    return rssFeeds.value.find((f) => f.id === id) || null;
  });

  async function loadRssFeeds() {
    const loading = ref(false);
    const error = ref("");
    await loadFeeds(rssFeeds, loading, error);
  }

  function onRssAddFeed() {
    rssEditingFeed.value = null;
    rssNewFeedUrl.value = "";
    rssNewFeedTitle.value = "";
    rssAddError.value = "";
    rssAddingFeed.value = true;
  }

  function onFeedEdit(feed) {
    rssEditingFeed.value = feed;
    rssNewFeedUrl.value = feed.url || "";
    rssNewFeedTitle.value = feed.title || "";
    rssAddError.value = "";
    rssAddingFeed.value = true;
  }

  async function submitRssAddFeed() {
    if (rssAddSubmitting.value) return;
    rssAddSubmitting.value = true;
    rssAddError.value = "";

    if (rssEditingFeed.value) {
      const url = rssNewFeedUrl.value.trim();
      if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
        rssAddError.value = "Invalid URL";
        rssAddSubmitting.value = false;
        return;
      }
      const ok = await updateFeed(rssEditingFeed.value.id, { url, title: rssNewFeedTitle.value.trim() });
      rssAddSubmitting.value = false;
      if (!ok) {
        rssAddError.value = "Failed to save";
        return;
      }
      rssAddingFeed.value = false;
      rssEditingFeed.value = null;
      await loadRssFeeds();
      return;
    }

    if (!rssNewFeedUrl.value.trim()) {
      rssAddSubmitting.value = false;
      return;
    }
    const result = await addFeed(rssNewFeedUrl.value.trim(), rssNewFeedTitle.value.trim());
    rssAddSubmitting.value = false;
    if (!result.ok) {
      rssAddError.value = result.detail;
      return;
    }
    rssAddingFeed.value = false;
    await loadRssFeeds();
    if (result.feed) {
      await nextTick();
      switchPane(`rss-${result.feed.id}`);
    }
  }

  async function checkRssUpdates() {
    if (!rssFeeds.value.length) return;
    const tempItems = ref([]);
    const tempLoading = ref(false);
    const tempError = ref("");
    await loadItems(tempItems, tempLoading, tempError, null);
    if (tempError.value) return;

    const counts = {};
    for (const item of tempItems.value) {
      if (isToday(item.date)) {
        counts[item.feed_id] = (counts[item.feed_id] || 0) + 1;
      }
    }
    rssNewItemCounts.value = counts;
  }

  async function onFeedRemoved(feedId) {
    const feed = rssFeeds.value.find((f) => f.id === feedId);
    const label = feed?.title || feed?.url || feedId;
    if (!await confirm(`Remove feed "${label}"? This cannot be undone.`)) return;
    await removeFeed(feedId);
    if (activePane.value === `rss-${feedId}`) {
      switchPane("jobs");
    }
    await loadRssFeeds();
  }

  let _rssBgTimer = null;

  onMounted(() => {
    _rssBgTimer = setInterval(checkRssUpdates, RSS_AUTO_REFRESH_MS);
  });

  onUnmounted(() => {
    clearInterval(_rssBgTimer);
  });

  return {
    rssFeeds,
    rssNewItemCounts,
    rssAddingFeed,
    rssEditingFeed,
    rssNewFeedUrl,
    rssNewFeedTitle,
    rssAddError,
    rssAddSubmitting,
    rssLabel,
    currentRssFeed,
    loadRssFeeds,
    onRssAddFeed,
    onFeedEdit,
    submitRssAddFeed,
    checkRssUpdates,
    onFeedRemoved,
  };
}
