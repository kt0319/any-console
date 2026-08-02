import { defineStore } from "pinia";
import { ref } from "vue";
import { EP_SETTINGS_INFO_PILLS } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";

const FIELDS = ["branch", "history", "prs", "actions", "changes", "devserver", "files", "add"];
const DEFAULT_ORDER = ["files", "history", "changes", "branch", "prs", "actions", "devserver", "add"];

export const useInfoPillConfigStore = defineStore("info-pill-config", () => {
  const branch = ref(true);
  const history = ref(true);
  const prs = ref(true);
  const actions = ref(true);
  const changes = ref(true);
  const devserver = ref(true);
  const files = ref(true);
  const add = ref(true);
  const order = ref([...DEFAULT_ORDER]);
  const loaded = ref(false);

  const fieldRefs = { branch, history, prs, actions, changes, devserver, files, add };

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

  function moveUp(field) {
    const idx = order.value.indexOf(field);
    if (idx <= 0) return;
    const next = [...order.value];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    order.value = next;
    save();
  }

  function moveDown(field) {
    const idx = order.value.indexOf(field);
    if (idx < 0 || idx >= order.value.length - 1) return;
    const next = [...order.value];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    order.value = next;
    save();
  }

  return { branch, history, prs, actions, changes, devserver, files, add, order, loaded, load, save, moveUp, moveDown };
});
