import { ref } from "vue";

export function useBranchAddDialog({ createBranch, createWorktree }: {
  createBranch: (name: string) => unknown,
  createWorktree: (name: string) => unknown,
}) {
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
