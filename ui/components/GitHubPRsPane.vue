<template>
  <div class="github-pane-wrapper pane-fill">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="github-section-body">
          <div v-if="isLoading" class="github-loading">Loading...</div>
          <div v-else-if="error" class="github-error">{{ error }}</div>
          <a
            v-for="item in items"
            :key="item.number"
            class="github-item"
            :href="githubUrl + '/pull/' + item.number"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="github-item-number">#{{ item.number }}</span>
            <span class="github-item-title text-ellipsis-flex">{{ item.title }}</span>
            <span v-if="item.isDraft" class="github-draft">Draft</span>
            <span v-if="item.headRefName" class="github-branch">{{ item.headRefName }}</span>
            <span v-if="item.author" class="github-item-author">{{ item.author }}</span>
            <span v-if="item.labels?.length" class="github-labels">
              <span
                v-for="label in item.labels"
                :key="label.name"
                class="github-label"
                :style="labelStyle(label.color)"
              >{{ label.name }}</span>
            </span>
          </a>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGitHubPane } from "../composables/useGitHubPane.ts";
import { useGitHub, labelStyle } from "../composables/useGitHub.ts";

const emit = defineEmits(["count"]);
const { loadPRs } = useGitHub();
const { githubUrl, items, isLoading, error, reload } = useGitHubPane(loadPRs, {
  onLoaded: (v) => emit("count", v.length),
});

defineExpose({ reload });
</script>

<style scoped>
@import "../styles/github-pane.css";
</style>
