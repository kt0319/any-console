import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "../composables/useApi.ts";
import { EP_GROUPS, EP_WORKSPACES, EP_WORKSPACES_STATUSES } from "../utils/endpoints.ts";
import { LS_PREFIX_WS_META } from "../utils/constants.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";

const STATUS_CACHE_KEY = LS_PREFIX_WS_META + "status_cache";
const STATUS_CACHE_FIELDS = ["last_commit_message", "branch"];

function loadStatusCache(): Record<string, Record<string, any>> {
  const parsed = safeJsonLoad(STATUS_CACHE_KEY, null);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function saveStatusCache(cache: Record<string, Record<string, any>>) {
  safeJsonSave(STATUS_CACHE_KEY, cache);
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const { apiGet } = useApi();
  const allWorkspaces = ref<Record<string, any>[]>([]);
  const groups = ref<Record<string, any>[]>([]);
  const selectedWorkspace = ref<string | null>(null);

  const currentWorkspace = computed(() =>
    allWorkspaces.value.find((w) => w.name === selectedWorkspace.value),
  );

  async function _safeFetch(endpoint: string) {
    try {
      return await apiGet(endpoint);
    } catch {
      return { ok: false, data: null };
    }
  }

  async function fetchWorkspaces() {
    const { ok, data } = await _safeFetch(EP_WORKSPACES);
    if (!ok || !Array.isArray(data)) return;
    const existingByName = new Map(allWorkspaces.value.map((w) => [w.name, w]));
    const cache = loadStatusCache();
    allWorkspaces.value = data.map((newWs) => {
      const existing = existingByName.get(newWs.name);
      const cached = cache[newWs.name] || {};
      // キャッシュ値・既存値をベースに新値で上書きする。group_id:null のような明示的な null も正規の値。
      // ステータス系フィールドは /workspaces レスポンスに無く、既存値が保持される。
      return { ...cached, ...(existing || {}), ...newWs };
    });
  }

  async function fetchGroups() {
    const { ok, data } = await _safeFetch(EP_GROUPS);
    if (!ok || !Array.isArray(data)) return;
    groups.value = data;
  }

  function applyStatuses(statuses: Record<string, any>[]) {
    if (!Array.isArray(statuses) || statuses.length === 0) return;
    const cache = loadStatusCache();
    for (const status of statuses) {
      const ws = allWorkspaces.value.find((w) => w.name === status.name);
      if (!ws) continue;
      for (const [k, v] of Object.entries(status)) {
        // transient な null で既存値を潰さないため null はスキップするが、未設定(undefined)には null も反映する
        // （未コミットのリポジトリは last_commit_message が null で、反映しないと statusLoading が解けない）。
        if (v != null) ws[k] = v;
        else if (ws[k] === undefined) ws[k] = v;
      }
      const entry: Record<string, any> = {};
      for (const field of STATUS_CACHE_FIELDS) {
        if (ws[field] != null) entry[field] = ws[field];
      }
      cache[status.name] = entry;
    }
    saveStatusCache(cache);
  }

  async function fetchStatuses() {
    const { ok, data } = await _safeFetch(EP_WORKSPACES_STATUSES);
    if (!ok) return;
    if (!data?.statuses) return;
    applyStatuses(data.statuses);
  }

  return {
    allWorkspaces,
    groups,
    selectedWorkspace,
    currentWorkspace,
    fetchWorkspaces,
    fetchGroups,
    applyStatuses,
    fetchStatuses,
  };
});
