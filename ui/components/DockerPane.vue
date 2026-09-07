<template>
  <div class="docker-pane-wrapper pane-fill">
    <div class="modal-scroll-body">
      <div v-if="!items.length" class="text-muted-center">No Docker containers</div>
      <div v-else class="docker-section-body">
        <div v-for="c in items" :key="c.id" class="docker-item">
          <span :class="['docker-run-status', dockerStateClass(c.state)]">
            <span class="mdi" :class="dockerStateIcon(c.state)"></span>
          </span>
          <span class="docker-item-title text-ellipsis-flex">{{ c.name }}</span>
          <span class="docker-item-meta">{{ c.image }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useDockerContainers } from "../composables/useDockerContainers.ts";

const workspaceStore = useWorkspaceStore();
const { containers, fetchContainers } = useDockerContainers();

const items = computed(() =>
  containers.value.filter((c) => c.workspace === workspaceStore.selectedWorkspace),
);

const DOCKER_STATE_ICON: Record<string, string> = {
  running: "mdi-play-circle-outline",
  paused: "mdi-pause-circle-outline",
  restarting: "mdi-autorenew",
  exited: "mdi-stop-circle-outline",
  dead: "mdi-close-circle-outline",
  created: "mdi-clock-outline",
};

function dockerStateIcon(state: string): string {
  return DOCKER_STATE_ICON[state] || "mdi-help-circle-outline";
}

const DOCKER_STATE_CLASS: Record<string, string> = {
  running: "docker-state-running",
  restarting: "docker-state-running",
  paused: "docker-state-paused",
  exited: "docker-state-exited",
  dead: "docker-state-exited",
};

function dockerStateClass(state: string): string {
  const cls = DOCKER_STATE_CLASS[state] || "docker-state-unknown";
  return state === "restarting" ? `${cls} docker-run-spin` : cls;
}

onMounted(fetchContainers);

defineExpose({ reload: fetchContainers });
</script>

<style scoped>
@import "../styles/docker-pane.css";
</style>
