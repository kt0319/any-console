<template>
  <div class="github-pane-wrapper">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="github-section-body">
          <div v-if="isLoading" class="github-loading">Loading...</div>
          <div v-else-if="error" class="github-error">{{ error }}</div>
          <div
            v-for="run in items"
            :key="run.id"
            class="github-item"
            @click="openUrl(run.url)"
          >
            <span :class="['github-run-status', runStatusClass(run.conclusion || run.status)]">
              {{ runStatusIcon(run.conclusion || run.status) }}
            </span>
            <span class="github-item-title">{{ run.name }}</span>
            <span class="github-item-meta">{{ run.headBranch }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useGitHub, runStatusIcon, runStatusClass, openUrl } from "../composables/useGitHub.js";

const { githubUrl, loadWorkspaceGithubUrl, loadActions } = useGitHub();
const items = ref([]);
const isLoading = ref(false);
const error = ref("");

async function reload() {
  loadWorkspaceGithubUrl();
  if (!githubUrl.value) return;
  await loadActions(items, isLoading, error);
}

onMounted(reload);
defineExpose({ reload });
</script>

<style scoped>
@import "../styles/github-pane.css";
</style>
