import { defineStore } from "pinia";
import { ref } from "vue";
import { defaultKeyDefs, defaultSpecialDefs } from "../utils/radial-key-presets.js";
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

export const useRadialConfigStore = defineStore("radial-config", () => {
  /** @type {import("vue").Ref<Array<{key: string, ctrl: boolean, shift: boolean, label: string}>>} */
  const keys = ref(defaultKeyDefs());
  /** @type {import("vue").Ref<Array<{label: string, action: string, payload: object | null}>>} */
  const specials = ref(defaultSpecialDefs());
  const loaded = ref(false);

  async function load() {
    const auth = useAuthStore();
    try {
      const res = await auth.apiFetch(EP_SETTINGS_RADIAL);
      if (res && res.ok) {
        const data = await res.json();
        keys.value = sanitizeKeys(data.keys);
        specials.value = sanitizeSpecials(data.specials);
      }
    } catch { /* keep defaults */ }
    loaded.value = true;
  }

  async function save() {
    const auth = useAuthStore();
    await auth.apiFetch(EP_SETTINGS_RADIAL, {
      method: "PUT",
      body: { keys: keys.value, specials: specials.value },
    });
  }

  function resetToDefaults() {
    keys.value = defaultKeyDefs();
    specials.value = defaultSpecialDefs();
  }

  return { keys, specials, loaded, load, save, resetToDefaults };
});
