<template>
  <span
    v-if="badge"
    class="agent-state-badge"
    :class="badge.className"
    role="img"
    :aria-label="badge.label"
    :data-tooltip="badge.label"
  >
    <span class="mdi" :class="badge.icon" aria-hidden="true"></span>
  </span>
</template>

<script setup>
// タブ・分割ペインのピルに出すエージェント状態バッジ。
// dirty ドット（workspace の軸・末尾の点）と混ざらないよう、状態は形の異なる
// アイコン＋アイコン群側（先頭側）で表現する。idle は無表示。
import { computed } from "vue";
import { agentStateBadge } from "../utils/agent-state.js";

const props = defineProps({
  state: { type: String, default: "" },
});

const badge = computed(() => agentStateBadge(props.state));
</script>

<style scoped>
.agent-state-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1;
}

.agent-state-blocked {
  color: var(--error);
}

.agent-state-done {
  color: var(--success);
}

.agent-state-working {
  color: var(--accent);
}

.agent-state-working .mdi {
  animation: agent-state-spin 1s linear infinite;
}

@keyframes agent-state-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .agent-state-working .mdi {
    animation: none;
  }
}
</style>
