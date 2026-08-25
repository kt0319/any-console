import { ref } from "vue";

/**
 * 「畳んだ状態が既定・開いた時だけ読み込む」折りたたみセクションの共通状態
 * （WorkspaceDetail の Branch / Stash セクションで共用）。
 * `load` は展開のたびに呼ばれる — once-load にしたい場合は呼び出し側で
 * paneLoader 等と組み合わせる。
 */
export function useCollapsibleSection(load: () => void) {
  const expanded = ref(false);

  function expand() {
    if (expanded.value) return;
    expanded.value = true;
    load();
  }

  function toggle() {
    if (expanded.value) {
      expanded.value = false;
    } else {
      expand();
    }
  }

  function collapse() {
    expanded.value = false;
  }

  return { expanded, toggle, expand, collapse };
}
