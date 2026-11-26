import type { Ref } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { useApi } from "../composables/useApi.ts";

/**
 * GET/PUT /settings/* の load/save 共通実装。取得失敗を defaults で握りつぶすと設定がリセットされたように見えるため、
 * 失敗時は 1 回リトライし、それでも駄目なら loaded を立てず次回の再取得に委ねる。空データ（初回・未保存）は正当な defaults。
 */
export function createServerSettings(
  endpoint: string,
  { loaded, apply, serialize }: {
    loaded: Ref<boolean>;
    apply: (data: any) => void;
    serialize: () => object;
  },
) {
  async function load() {
    const auth = useAuthStore();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await auth.apiFetch(endpoint);
        if (res && res.ok) {
          apply(await res.json());
          loaded.value = true;
          return;
        }
      } catch { /* リトライへ */ }
    }
  }

  async function save() {
    const { apiPut } = useApi();
    const { ok } = await apiPut(endpoint, serialize(), { errorMessage: "Failed to save settings" });
    return ok;
  }

  return { load, save };
}
