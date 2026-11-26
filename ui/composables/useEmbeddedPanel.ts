import { inject, onMounted, type Ref } from "vue";
import { emit as bridgeEmit } from "../app-bridge.ts";

// SendHistory.vue / SendSnippet.vue 共有の、設定モーダル / KeyboardBar 埋め込み両対応パネルの定型。
// embedded=true は設定モーダルを開かないため、閉じる操作は親への close emit。
export function useEmbeddedPanel({ embedded, title, emit }: {
  embedded: boolean,
  title: string,
  emit: (event: "close") => void,
}) {
  const modalTitle = inject<Ref<string> | null>("modalTitle", null);

  onMounted(() => {
    if (!embedded && modalTitle) modalTitle.value = title;
  });

  function closePanel() {
    if (embedded) emit("close");
    else bridgeEmit("modal:close");
  }

  return { closePanel };
}
