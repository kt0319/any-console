<template>
  <div
    v-if="isOpen"
    class="modal-overlay"
    :class="overlayClass"
    role="dialog"
    aria-modal="true"
    @mousedown.self="emit('overlay')"
  >
    <div ref="modalEl" class="modal">
      <div class="settings-panel-header">
        <button
          type="button"
          class="modal-title-wrap"
          :class="{ 'is-clickable': canBack, 'no-back': !canBack }"
          :tabindex="canBack ? 0 : -1"
          :aria-disabled="!canBack ? 'true' : 'false'"
          @click="canBack && emit('back')"
        >
          <h3 class="modal-title">
            <span v-if="canBack && showBackArrow" class="mdi mdi-arrow-left modal-title-back-icon" aria-hidden="true"></span>
            <span class="modal-title-text text-ellipsis-flex">{{ title }}<template v-if="branch"><span class="modal-title-sep"> / </span><span class="modal-title-branch" :data-tooltip="branch">{{ branch }}</span></template></span>
          </h3>
        </button>
        <button
          type="button"
          class="modal-close-btn"
          :aria-label="closeLabel"
          :data-tooltip="closeLabel"
          @click="emit('close')"
        >&times;</button>
      </div>
      <div class="settings-panel-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useModal } from "../composables/useModal.ts";

// 全面オーバーレイモーダルの共通シェル。
// TerminalSettingsModal / SessionOpenModal / WorkspaceDetailModal が丸ごと
// 複製していたテンプレート（.modal-overlay/.modal/.settings-panel-header/
// .settings-panel-body）と scoped CSS（約90行×3）をここに一本化した。
// フォーカストラップ（useModal）もここで面倒を見る — Esc は `escape` を
// emit するだけなので、閉じるか戻るかは各ホストが決める。
//
// ホスト側に残るのは「どのビューを body に出すか」「back/close/escape/
// overlay クリックで何をするか」だけ。

const props = defineProps<{
  isOpen: boolean,
  title: string,
  branch?: string,
  /// タイトル部が「戻る」ボタンとして機能するか（false ならクリック不可）。
  canBack?: boolean,
  /// タイトル左の ← アイコンを出すか（WorkspaceDetail は常時クリック可能
  /// だがアイコンは出さない従来見た目のため false にする）。
  showBackArrow?: boolean,
  closeLabel: string,
  /// E2E・スタイルフックに使う overlay の追加クラス（例: "session-open-modal"）。
  overlayClass?: string,
}>();

const emit = defineEmits<{
  (e: "back"): void,
  (e: "close"): void,
  (e: "overlay"): void,
  (e: "escape"): void,
}>();

const modal = useModal();
const modalEl = ref<HTMLElement | null>(null);

watch(
  () => props.isOpen,
  (shouldShow) => {
    if (shouldShow) {
      modal.open(() => modalEl.value, () => emit("escape"));
    } else if (modal.visible.value) {
      modal.close();
    }
  },
);
</script>

<style scoped>
/* .modal-overlay / .modal-title系 / .modal-close-btn の共通の見た目は
   ui/styles/modal-shell.css（グローバル）で他のオーバーレイと共用する。
   ここには全面オーバーレイ型シェルの差分だけを置く。 */
.modal {
  background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
  width: 100%;
  max-width: 100%;
  height: 100%;
  border: none;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* Modal.vue（モバイルの設定オーバーレイ）と同じボトムシート風にする。
   モバイルはタイトルを下部に表示し、PC幅では通常通り上部に戻す。 */
.settings-panel-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
  order: 1;
}

@media (min-width: 769px) {
  .settings-panel-header {
    border-bottom: 1px solid var(--border);
    border-top: none;
    padding-bottom: 0;
    order: 0;
  }
}

.modal-title-wrap.is-clickable {
  cursor: pointer;
}

.modal-close-btn {
  margin-left: auto;
}

.modal-title-back-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  color: inherit;
}


.settings-panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  order: 0;
}

@media (min-width: 769px) {
  .settings-panel-body {
    order: 1;
  }
}

/* 各ペインが使う .modal-scroll-body（スクロール本体）の契約は
   ui/styles/modal-shell.css の .settings-panel-body .modal-scroll-body 参照。 */
</style>
