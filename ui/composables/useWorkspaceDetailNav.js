import { ref, computed } from "vue";

// WorkspaceDetail（Files/Changes/History/Branches/Jobs/Stash）専用のナビゲー
// ション状態。useSettingsNav.jsのビュースタックとは完全に独立させている
// （以前はSettingsのスタックに"WorkspaceDetail"を積んでいたため、開くたびに
// セッション一覧/設定側の表示（currentView・modalTitle）まで巻き込んで
// 切り替わってしまっていた）。WorkspaceDetailを開いても、裏の
// SessionSidebar.vue/Modal.vue側の表示はそのまま変化しない。
//
// WorkspaceDetail.vueはuseModalView()経由でmodalTitle/modalBranch/viewState/
// updateViewStateをinjectする前提のため、WorkspaceDetailModal.vueはこの
// composableの値をその名前でprovideする（pushView/popViewだけは、Jobsペイン
// からJobConfigを開く導線のためuseSettingsNav.js側の実物をprovideする）。

const isOpen = ref(false);
const detail = ref(/** @type {Record<string, any>} */ ({}));
const modalTitle = ref("");
const modalBranch = ref("");
/** @type {import("vue").Ref<{ handleBack?: () => boolean } | null>} */
const currentPaneRef = ref(null);

const viewState = computed(() => ({ detail: detail.value }));

function open(newDetail = {}) {
  detail.value = newDetail;
  modalTitle.value = "";
  modalBranch.value = "";
  isOpen.value = true;
}

function updateViewState(state) {
  detail.value = state?.detail ?? {};
}

function setPaneRef(el) {
  currentPaneRef.value = el;
}

function close() {
  isOpen.value = false;
  modalTitle.value = "";
  modalBranch.value = "";
  currentPaneRef.value = null;
}

function onBack() {
  if (currentPaneRef.value?.handleBack?.()) return;
  close();
}

export function useWorkspaceDetailNav() {
  return { isOpen, viewState, modalTitle, modalBranch, open, close, onBack, setPaneRef, updateViewState };
}
