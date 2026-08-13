<template>
  <div class="github-pane-wrapper">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="github-section-body">
          <div v-if="isLoading" class="github-loading">Loading...</div>
          <div v-else-if="error" class="github-error">{{ error }}</div>
          <div
            v-for="item in items"
            :key="item.number"
            class="github-item"
            @click="openUrl(githubUrl + '/issues/' + item.number)"
          >
            <span class="github-item-number">#{{ item.number }}</span>
            <span class="github-item-title">{{ item.title }}</span>
            <span v-if="item.author" class="github-item-author">{{ item.author }}</span>
            <span v-if="item.labels?.length" class="github-labels">
              <span
                v-for="label in item.labels"
                :key="label.name"
                class="github-label"
                :style="labelStyle(label.color)"
              >{{ label.name }}</span>
            </span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { useGitHubPane } from "../composables/useGitHubPane.ts";
import { useGitHub, labelStyle, openUrl } from "../composables/useGitHub.ts";

const emit = defineEmits(["count"]);
const { loadIssues } = useGitHub();
const { githubUrl, items, isLoading, error, reload } = useGitHubPane(loadIssues, {
  onLoaded: (v) => emit("count", v.length),
});

defineExpose({ reload });
</script>

<style scoped>
@import "../styles/github-pane.css";
</style>
