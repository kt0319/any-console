<template>
  <div class="github-pane-wrapper pane-fill">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="github-section-body">
          <div v-if="isLoading" class="github-loading loading-dots">Loading</div>
          <div v-else-if="error" class="github-error">{{ error }}</div>
          <div v-else-if="!items.length" class="text-muted-center">No workflow runs</div>
          <a
            v-for="run in items"
            :key="run.id"
            class="github-item"
            :href="run.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span :class="['github-run-status', runStatusClass(run.conclusion || run.status)]">
              <span class="mdi" :class="runStatusIcon(run.conclusion || run.status)"></span>
            </span>
            <span class="github-item-title text-ellipsis-flex">{{ run.name }}</span>
            <span class="github-item-meta">{{ run.headBranch }}</span>
          </a>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGitHubPane } from "../composables/useGitHubPane.ts";
import { useGitHub, runStatusIcon, runStatusClass } from "../composables/useGitHub.ts";

const { loadActions } = useGitHub();
const { githubUrl, items, isLoading, error, reload } = useGitHubPane(loadActions);

defineExpose({ reload });
</script>

<style scoped>
@import "../styles/github-pane.css";
</style>
