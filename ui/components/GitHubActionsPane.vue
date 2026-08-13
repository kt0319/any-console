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
import { useGitHubPane } from "../composables/useGitHubPane.ts";
import { useGitHub, runStatusIcon, runStatusClass, openUrl } from "../composables/useGitHub.ts";

const { loadActions } = useGitHub();
const { githubUrl, items, isLoading, error, reload } = useGitHubPane(loadActions);

defineExpose({ reload });
</script>

<style scoped>
@import "../styles/github-pane.css";
</style>
