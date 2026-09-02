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
      <ModalHeader
        :title="title"
        :branch="branch"
        :can-back="canBack"
        :show-back-arrow="showBackArrow"
        :close-label="closeLabel"
        :panel-bottom="isPanelBottom"
        @back="emit('back')"
        @close="emit('close')"
      />
      <div class="settings-panel-body" :class="{ 'panel-bottom': isPanelBottom }">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useModal } from "../composables/useModal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import ModalHeader from "./ModalHeader.vue";

// 全面オーバーレイモーダルの共通シェル。
// TerminalSettingsModal / SessionOpenModal / WorkspaceDetailModal が丸ごと
// 複製していたテンプレート（.modal-overlay/.modal/.settings-panel-header/
// .settings-panel-body）と scoped CSS（約90行×3）をここに一本化した。
// フォーカストラップ（useModal）もここで面倒を見る — Esc は `escape` を
// emit するだけなので、閉じるか戻るかは各ホストが決める。
// ヘッダー（タイトル+戻る/閉じる）はModalHeader.vue（SessionListPanel.vue
// と共用）に切り出してある。
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
const layoutStore = useLayoutStore();
const isPanelBottom = computed(() => layoutStore.isPanelBottom);

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

/* Modal.vue（モバイルの設定オーバーレイ）と同じボトムシート風にする。既定
   （タブバー: Top相当）はヘッダーを上部固定にし、セッションタブがボトム
   配置（Settings > Display）の時だけヘッダーも下部（ボトムシート風）に
   揃える。ヘッダー自体の見た目（panel-bottom時の境界線・safe-area余白）は
   ModalHeader.vue側が持ち、ここではheader/bodyの並び順（order）だけ切り
   替える。 */
.settings-panel-header {
  order: 0;
}

.settings-panel-header.panel-bottom {
  order: 1;
}

.settings-panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  order: 1;
}

.settings-panel-body.panel-bottom {
  order: 0;
}

/* 各ペインが使う .modal-scroll-body（スクロール本体）の契約は
   ui/styles/modal-shell.css の .settings-panel-body .modal-scroll-body 参照。 */
</style>
