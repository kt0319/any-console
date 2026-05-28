import { ref } from "vue";
import { useApi } from "./useApi.js";
import { useWorkspaceStore } from "../stores/workspace.js";

export function useRSS() {
  const { apiGet, apiPost, apiPatch, apiDelete, wsEndpoint } = useApi();
  const workspaceStore = useWorkspaceStore();

  function rssEndpoint(path) {
    return wsEndpoint(workspaceStore.selectedWorkspace, `rss/${path}`);
  }

  async function loadFeeds(feedsRef, loadingRef, errorRef) {
    if (!workspaceStore.selectedWorkspace) return;
    loadingRef.value = true;
    errorRef.value = "";
    try {
      const { ok, data } = await apiGet(rssEndpoint("feeds"));
      if (ok && data?.status === "ok") {
        feedsRef.value = data.data || [];
      } else {
        errorRef.value = data?.detail || "Failed to load feeds";
      }
    } catch {
      errorRef.value = "Failed to load feeds";
    } finally {
      loadingRef.value = false;
    }
  }

  async function loadItems(itemsRef, loadingRef, errorRef, feedErrorsRef) {
    if (!workspaceStore.selectedWorkspace) return;
    loadingRef.value = true;
    errorRef.value = "";
    try {
      const { ok, data } = await apiGet(rssEndpoint("items"));
      if (ok && data?.status === "ok") {
        itemsRef.value = data.data || [];
        if (feedErrorsRef) feedErrorsRef.value = data.errors || {};
      } else {
        errorRef.value = data?.detail || "Failed to load items";
      }
    } catch {
      errorRef.value = "Failed to load items";
    } finally {
      loadingRef.value = false;
    }
  }

  async function addFeed(url, title = "") {
    const body = { url };
    if (title) body.title = title;
    const { ok, data } = await apiPost(rssEndpoint("feeds"), body);
    if (!ok || data?.status !== "ok") {
      return { ok: false, detail: data?.detail || "Failed to add feed" };
    }
    return { ok: true, feed: data.data };
  }

  async function removeFeed(feedId) {
    const { ok } = await apiDelete(rssEndpoint(`feeds/${feedId}`));
    return ok;
  }

  async function updateFeed(feedId, { url = "", title = "" } = {}) {
    const body = {};
    if (url) body.url = url;
    if (title !== undefined) body.title = title;
    const { ok } = await apiPatch(rssEndpoint(`feeds/${feedId}`), body);
    return ok;
  }

  return { loadFeeds, loadItems, addFeed, removeFeed, updateFeed };
}

export function formatItemDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const today = now.toDateString();
    if (d.toDateString() === today) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 1) return "1d ago";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
