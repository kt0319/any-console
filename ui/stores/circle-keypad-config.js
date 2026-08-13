import { defineStore } from "pinia";
import { ref } from "vue";
import { defaultKeyDefs, defaultSpecialDefs } from "../utils/circle-keypad-presets.ts";
import { EP_SETTINGS_CIRCLE_KEYPAD } from "../utils/endpoints.ts";
import { createServerSettings } from "../utils/server-settings.ts";

function sanitizeKeys(keys) {
  if (!Array.isArray(keys) || keys.length !== 8) return defaultKeyDefs();
  return keys.map((k) => ({
    key: typeof k?.key === "string" ? k.key : "",
    ctrl: !!k?.ctrl,
    shift: !!k?.shift,
    alt: !!k?.alt,
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
  /** @type {import("vue").Ref<Array<{key: string, ctrl: boolean, shift: boolean, alt: boolean, label: string}>>} */
  const keys = ref(defaultKeyDefs());
  /** @type {import("vue").Ref<Array<{label: string, action: string, payload: object | null}>>} */
  const specials = ref(defaultSpecialDefs());
  const enabled = ref(true);
  const loaded = ref(false);

  // load のリトライ・loaded 確定の方針は createServerSettings 参照。
  const { load, save } = createServerSettings(EP_SETTINGS_CIRCLE_KEYPAD, {
    loaded,
    apply(data) {
      keys.value = sanitizeKeys(data.keys);
      specials.value = sanitizeSpecials(data.specials);
      enabled.value = data.enabled !== false;
    },
    serialize: () => ({ keys: keys.value, specials: specials.value, enabled: enabled.value }),
  });

  function resetToDefaults() {
    keys.value = defaultKeyDefs();
    specials.value = defaultSpecialDefs();
    enabled.value = true;
  }

  return { keys, specials, enabled, loaded, load, save, resetToDefaults };
});
