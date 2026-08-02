import { defineStore } from "pinia";
import { ref } from "vue";
import { EP_SETTINGS_INFO_PILLS } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";

const FIELDS = ["workspace", "branch", "history", "prs", "changes", "pull", "push", "devserver", "files", "add"];

export const useInfoPillConfigStore = defineStore("info-pill-config", () => {
  const workspace = ref(true);
  const branch = ref(true);
  const history = ref(true);
  const prs = ref(true);
  const changes = ref(true);
  const pull = ref(true);
  const push = ref(true);
  const devserver = ref(true);
  const files = ref(true);
  const add = ref(true);
  const loaded = ref(false);

  const fieldRefs = { workspace, branch, history, prs, changes, pull, push, devserver, files, add };

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
          loaded.value = true;
          return;
        }
      } catch { /* リトライへ */ }
    }
  }

  async function save() {
    const auth = useAuthStore();
    const body = {};
    for (const field of FIELDS) body[field] = fieldRefs[field].value;
    await auth.apiFetch(EP_SETTINGS_INFO_PILLS, { method: "PUT", body });
  }

  return { workspace, branch, history, prs, changes, pull, push, devserver, files, add, loaded, load, save };
});
