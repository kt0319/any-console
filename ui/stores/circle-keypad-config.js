import { defineStore } from "pinia";
import { ref } from "vue";
import { defaultKeyDefs, defaultSpecialDefs } from "../utils/circle-keypad-presets.js";
import { EP_SETTINGS_RADIAL } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";

function sanitizeKeys(keys) {
  if (!Array.isArray(keys) || keys.length !== 8) return defaultKeyDefs();
  return keys.map((k) => ({
    key: typeof k?.key === "string" ? k.key : "",
    ctrl: !!k?.ctrl,
    shift: !!k?.shift,
    label: typeof k?.label === "string" ? k.label : "",
  }));
}

function sanitizeSpecials(specials) {
  if (!Array.isArray(specials) || specials.length !== 4) return defaultSpecialDefs();
  return specials.map((s) => ({
    label: typeof s?.label === "string" ? s.label : "",
    action: typeof s?.action === "string" ? s.action : "",
    payload: s?.payload && typeof s.payload === "object" ? s.payload : null,
  }));
}

export const useCircleKeyPadConfigStore = defineStore("circle-keypad-config", () => {
  /** @type {import("vue").Ref<Array<{key: string, ctrl: boolean, shift: boolean, label: string}>>} */
  const keys = ref(defaultKeyDefs());
  /** @type {import("vue").Ref<Array<{label: string, action: string, payload: object | null}>>} */
  const specials = ref(defaultSpecialDefs());
  const enabled = ref(true);
  const loaded = ref(false);

  // 取得失敗を defaults で握りつぶすと、サーバに設定があってもリセットされたように
  // 見える（loaded=true で確定してしまい再取得もされない）。失敗時は 1 回リトライし、
  // それでもダメなら loaded を立てず、次に開いたときの再取得に委ねる。
  // res.ok かつ空配列（初回・未保存）は正当な defaults なので通常成功として扱う。
  async function load() {
    const auth = useAuthStore();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await auth.apiFetch(EP_SETTINGS_RADIAL);
        if (res && res.ok) {
          const data = await res.json();
          keys.value = sanitizeKeys(data.keys);
          specials.value = sanitizeSpecials(data.specials);
          enabled.value = data.enabled !== false;
          loaded.value = true;
          return;
        }
      } catch { /* リトライへ */ }
    }
  }

  async function save() {
    const auth = useAuthStore();
    await auth.apiFetch(EP_SETTINGS_RADIAL, {
      method: "PUT",
      body: { keys: keys.value, specials: specials.value, enabled: enabled.value },
    });
  }

  function resetToDefaults() {
    keys.value = defaultKeyDefs();
    specials.value = defaultSpecialDefs();
    enabled.value = true;
  }

  return { keys, specials, enabled, loaded, load, save, resetToDefaults };
});
