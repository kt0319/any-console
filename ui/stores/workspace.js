import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "../composables/useApi.js";
import { EP_GROUPS, EP_WORKSPACES, EP_WORKSPACES_STATUSES } from "../utils/endpoints.js";
import { LS_PREFIX_WS_META } from "../utils/constants.js";

const STATUS_CACHE_KEY = LS_PREFIX_WS_META + "status_cache";
const STATUS_CACHE_FIELDS = ["last_commit_message", "branch"];

function loadStatusCache() {
  try {
    const raw = localStorage.getItem(STATUS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStatusCache(cache) {
  try {
    localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota or other — ignore */
  }
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const { apiGet } = useApi();
  const allWorkspaces = ref(/** @type {Record<string, any>[]} */ ([]));
  const groups = ref(/** @type {Record<string, any>[]} */ ([]));
  const selectedWorkspace = ref(/** @type {string|null} */ (null));
  const workspaceJobs = ref({});

  const currentWorkspace = computed(() =>
    allWorkspaces.value.find((w) => w.name === selectedWorkspace.value),
  );

  async function _safeFetch(endpoint) {
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
      // キャッシュ値・既存値をベースに新値で上書き。
      // group_id:null のような「明示的なnull」も正規の値なので null ガードは掛けない。
      // ステータス系フィールド(clean/ahead/behind 等)は /workspaces レスポンスに含まれないため
      // 既存値が自然に保持される。
      return { ...cached, ...(existing || {}), ...newWs };
    });
  }

  async function fetchGroups() {
    const { ok, data } = await _safeFetch(EP_GROUPS);
    if (!ok || !Array.isArray(data)) return;
    groups.value = data;
  }

  /**
   * ステータス配列（/workspaces/statuses の statuses、または WS push の statuses）を
   * ストアへマージする。
   * @param {Record<string, any>[]} statuses
   */
  function applyStatuses(statuses) {
    if (!Array.isArray(statuses) || statuses.length === 0) return;
    const cache = loadStatusCache();
    for (const status of statuses) {
      const ws = allWorkspaces.value.find((w) => w.name === status.name);
      if (!ws) continue;
      for (const [k, v] of Object.entries(status)) {
        // 良い既存値を transient な null で潰さないため null はスキップするが、
        // 未設定（undefined）のフィールドには null も反映する。未コミットのリポジトリは
        // last_commit_message が null で返り、これを反映しないと statusLoading が
        // 解けず「Loading」表示が残るため。
        if (v != null) ws[k] = v;
        else if (ws[k] === undefined) ws[k] = v;
      }
      const entry = {};
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
    workspaceJobs,
    currentWorkspace,
    fetchWorkspaces,
    fetchGroups,
    applyStatuses,
    fetchStatuses,
  };
});
