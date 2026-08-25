import { defineStore } from "pinia";
import { ref } from "vue";
import { CIRCLE_KEYPAD_SPECIAL_PRESETS, defaultKeyDefs, defaultSpecialDefs } from "../utils/circle-keypad-presets.ts";
import { EP_SETTINGS_CIRCLE_KEYPAD } from "../utils/endpoints.ts";
import { createServerSettings } from "../utils/server-settings.ts";

export interface CircleKeypadKeyDef {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  label: string;
}

export interface CircleKeypadSpecialDef {
  label: string;
  action: string;
  payload: object | null;
}

function sanitizeKeys(keys: any): CircleKeypadKeyDef[] {
  if (!Array.isArray(keys) || keys.length !== 8) return defaultKeyDefs();
  return keys.map((k: any) => ({
    key: typeof k?.key === "string" ? k.key : "",
    ctrl: !!k?.ctrl,
    shift: !!k?.shift,
    alt: !!k?.alt,
    label: typeof k?.label === "string" ? k.label : "",
  }));
}

function sanitizeSpecials(specials: any): CircleKeypadSpecialDef[] {
  if (!Array.isArray(specials) || specials.length !== 4) return defaultSpecialDefs();
  return specials.map((s: any) => {
    const action = typeof s?.action === "string" ? s.action : "";
    const payload = s?.payload && typeof s.payload === "object" ? s.payload : null;
    const preset = CIRCLE_KEYPAD_SPECIAL_PRESETS.find((p) =>
      p.action === action
      && JSON.stringify(p.payload || null) === JSON.stringify(payload)
    );
    return preset
      ? { label: preset.label, action: preset.action, payload: preset.payload || null }
      : { label: "", action: "", payload: null };
  });
}

export const useCircleKeypadConfigStore = defineStore("circle-keypad-config", () => {
  const keys = ref<CircleKeypadKeyDef[]>(defaultKeyDefs());
  const specials = ref<CircleKeypadSpecialDef[]>(defaultSpecialDefs());
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
