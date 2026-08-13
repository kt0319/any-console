import { defineStore } from "pinia";
import { ref } from "vue";
import { EP_SETTINGS_INFO_PILLS } from "../utils/endpoints.ts";
import { INFO_PILL_FIELDS } from "../utils/info-pills.ts";
import { createServerSettings } from "../utils/server-settings.ts";

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

  // load のリトライ・loaded 確定の方針は createServerSettings 参照。
  const { load, save } = createServerSettings(EP_SETTINGS_INFO_PILLS, {
    loaded,
    apply(data) {
      for (const field of FIELDS) {
        fieldRefs[field].value = data?.[field] !== false;
      }
      order.value = Array.isArray(data?.order) && data.order.length ? data.order : [...DEFAULT_ORDER];
    },
    serialize() {
      const body = { order: order.value };
      for (const field of FIELDS) body[field] = fieldRefs[field].value;
      return body;
    },
  });

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
