import type { Ref } from "vue";
import { useAuthStore } from "../stores/auth.js";

/**
 * サーバ設定エンドポイント（GET/PUT の /settings/*）の load/save 共通実装。
 *
 * 取得失敗を defaults で握りつぶすと、サーバに設定があってもリセットされたように
 * 見える（loaded=true で確定してしまい再取得もされない）。失敗時は 1 回リトライし、
 * それでもダメなら loaded を立てず、次に開いたときの再取得に委ねる。
 * res.ok かつ空データ（初回・未保存）は正当な defaults なので通常成功として扱う。
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
    const auth = useAuthStore();
    await auth.apiFetch(endpoint, { method: "PUT", body: serialize() });
  }

  return { load, save };
}
