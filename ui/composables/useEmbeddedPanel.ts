import { inject, onMounted, type Ref } from "vue";
import { emit as bridgeEmit } from "../app-bridge.ts";

// SendHistory.vue / SendSnippet.vue が共有する「設定モーダル / KeyboardBar
// 埋め込みの両方で使えるパネル」の定型。
//
// embedded=true はキーボードバーのタブからQWERTYパネル内へ直接オーバーレイ
// 表示する場合（設定モーダルは開かないため、閉じる操作は親への close emit）。
// 通常（設定モーダル経由）は false で、modalTitle の設定と modal:close を使う
// 既存の挙動のまま。
export function useEmbeddedPanel({ embedded, title, emit }: {
  embedded: boolean,
  title: string,
  emit: (event: "close") => void,
}) {
  const modalTitle = inject<Ref<string> | null>("modalTitle", null);

  onMounted(() => {
    if (!embedded && modalTitle) modalTitle.value = title;
  });

  /** コマンド挿入後などにパネルを閉じる（表示元に応じた閉じ方をする）。 */
  function closePanel() {
    if (embedded) emit("close");
    else bridgeEmit("modal:close");
  }

  return { closePanel };
}
