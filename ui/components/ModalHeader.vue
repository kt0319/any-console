<template>
  <div class="settings-panel-header" :class="{ 'panel-bottom': panelBottom }">
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
</template>

<script setup lang="ts">
// モーダル/サイドバー系オーバーレイ共通のヘッダー（タイトル+戻る、閉じる
// ボタン）。ModalShell.vue（全面オーバーレイ）とSessionListPanel.vue
// （セッション一覧、Modal.vue全面オーバーレイ/SessionSidebar.vueインライン
// の両方から使われる）で共用する。panelBottomはヘッダーを画面上部/下部の
// どちらに寄せるか（ボトムシート風にするか）を切り替える——呼び出し元が
// 「実際にタブバーと同じ側に来るべきか」を判断して渡す（ModalShell.vueは
// layoutStore.isPanelBottom、SessionSidebar.vue経由のPCインライン表示は
// 常にfalse固定など）。

defineProps<{
  title: string,
  branch?: string,
  /// タイトル部が「戻る」ボタンとして機能するか（false ならクリック不可）。
  canBack?: boolean,
  /// タイトル左の ← アイコンを出すか（WorkspaceDetail は常時クリック可能
  /// だがアイコンは出さない従来見た目のため false にする）。
  showBackArrow?: boolean,
  closeLabel: string,
  /// ヘッダーを下部（ボトムシート風）に寄せるか。
  panelBottom?: boolean,
}>();

const emit = defineEmits<{
  (e: "back"): void,
  (e: "close"): void,
}>();
</script>

<style scoped>
/* .modal-title系/.modal-close-btnの共通の見た目は
   ui/styles/modal-shell.css（グローバル）で他のオーバーレイと共用する。
   ここには配置（上部/下部）の差分だけを置く。 */
.settings-panel-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  border-top: none;
  padding-bottom: 0;
}

.settings-panel-header.panel-bottom {
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
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
</style>
