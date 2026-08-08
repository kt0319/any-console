import { defineStore } from "pinia";
import { ref } from "vue";
import { EP_SETTINGS_INFO_PILLS } from "../utils/endpoints.js";
import { INFO_PILL_FIELDS } from "../utils/info-pills.js";
import { useAuthStore } from "./auth.js";

// フィールド一覧・デフォルト表示順はinfo-pills.jsのディスクリプタテーブルから導出する。
const FIELDS = INFO_PILL_FIELDS;
const DEFAULT_ORDER = INFO_PILL_FIELDS;

export const useInfoPillConfigStore = defineStore("info-pill-config", () => {
  const branch = ref(true);
  const history = ref(true);
  const prs = ref(true);
  const actions = ref(true);
  const changes = ref(true);
  const devserver = ref(true);
  const files = ref(true);
  const add = ref(true);
  const dispatch = ref(true);
  const order = ref([...DEFAULT_ORDER]);
  const loaded = ref(false);

  const fieldRefs = { branch, history, prs, actions, changes, devserver, files, add, dispatch };

  // 取得失敗を defaults で握りつぶすと、サーバに設定があってもリセットされたように
  // 見える（loaded=true で確定してしまい再取得もされない）。失敗時は 1 回リトライし、
  // それでもダメなら loaded を立てず、次に開いたときの再取得に委ねる。
  async function load() {
    const auth = useAuthStore();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await auth.apiFetch(EP_SETTINGS_INFO_PILLS);
        if (res && res.ok) {
          const data = await res.json();
          for (const field of FIELDS) {
            fieldRefs[field].value = data?.[field] !== false;
          }
          order.value = Array.isArray(data?.order) && data.order.length ? data.order : [...DEFAULT_ORDER];
          loaded.value = true;
          return;
        }
      } catch { /* リトライへ */ }
    }
  }

  async function save() {
    const auth = useAuthStore();
    const body = { order: order.value };
    for (const field of FIELDS) body[field] = fieldRefs[field].value;
    await auth.apiFetch(EP_SETTINGS_INFO_PILLS, { method: "PUT", body });
  }

  // useListDragSort の onReorder(fromIdx, toIdx) にそのまま渡せる形にする
  // （SessionListView.vue の terminalStore.moveTab と同じsplice方式）。
  function reorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= order.value.length) return;
    if (toIndex < 0 || toIndex >= order.value.length) return;
    const next = [...order.value];
    const [field] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, field);
    order.value = next;
    save();
  }

  return { branch, history, prs, actions, changes, devserver, files, add, dispatch, order, loaded, load, save, reorder };
});
