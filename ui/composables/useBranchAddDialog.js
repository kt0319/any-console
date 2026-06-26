import { ref } from "vue";

/**
 * ブランチ / worktree 追加ダイアログの状態と送信処理をまとめる。
 * 送信時は addType に応じて createBranch / createWorktree を呼び分ける。
 *
 * @param {{
 *   createBranch: (name: string) => unknown,
 *   createWorktree: (name: string) => unknown,
 * }} actions
 */
export function useBranchAddDialog({ createBranch, createWorktree }) {
  const addModalOpen = ref(false);
  const addType = ref("branch");
  const addName = ref("");

  function openAddModal() {
    addName.value = "";
    addType.value = "branch";
    addModalOpen.value = true;
  }

  function closeAddModal() {
    addModalOpen.value = false;
  }

  async function submitAddModal() {
    const name = addName.value.trim();
    if (!name) return;
    addModalOpen.value = false;
    if (addType.value === "worktree") {
      await createWorktree(name);
    } else {
      await createBranch(name);
    }
  }

  return { addModalOpen, addType, addName, openAddModal, closeAddModal, submitAddModal };
}
