<template>
  <div
    v-if="visible"
    ref="overlayEl"
    class="dialog-overlay"
    :style="{ zIndex }"
    @click.self="$emit('dismiss')"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue";
import { focusFirstFocusable, trapFocusWithin } from "../composables/useModal.ts";
import { isTouchOnly, listenForEscape } from "../utils/keyboard.ts";

/**
 * ダイアログ共通シェル。オーバーレイ描画・フォーカストラップ・Esc で閉じる・
 * フォーカス復元を一手に引き受ける（CLAUDE.md のモーダル MUST 要件）。
 * ダイアログ本体（box）は slot 側が持ち、role="dialog" / aria-modal も slot 側に置く。
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  zIndex: { type: Number, default: 200 },
  // "first": 開いたら最初のフォーカス可能要素へ移す（タッチ端末では抑制）。
  // "none": フォーカス移動は呼び出し側が行う（入力欄へ直接フォーカスするダイアログ用）。
  initialFocus: { type: String, default: "first" },
});
const emit = defineEmits(["dismiss"]);

const overlayEl = ref<HTMLElement | null>(null);
let prevFocus: Element | null = null;
let releaseEscape: (() => void) | null = null;
let releaseTrap: (() => void) | null = null;

function releaseAll() {
  releaseTrap?.();
  releaseTrap = null;
  releaseEscape?.();
  releaseEscape = null;
}

watch(() => props.visible, async (visible) => {
  if (visible) {
    prevFocus = document.activeElement;
    releaseEscape = listenForEscape(() => emit("dismiss"));
    await nextTick();
    if (!overlayEl.value) return;
    releaseTrap?.();
    releaseTrap = trapFocusWithin(overlayEl.value);
    // タッチデバイスでは自動フォーカスしない（ソフトキーボードの誤起動を防ぐ）
    if (props.initialFocus === "first" && !isTouchOnly()) {
      focusFirstFocusable(overlayEl.value);
    }
    return;
  }
  releaseAll();
  // タッチデバイスでは復元しない（xterm 等へ戻すとソフトキーボードが起動するため）
  if (!isTouchOnly()) {
    await nextTick();
    (prevFocus as HTMLElement | null)?.focus?.();
  }
  prevFocus = null;
});

onUnmounted(releaseAll);
</script>
