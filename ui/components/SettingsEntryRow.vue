<template>
  <div class="device-row">
    <div class="device-meta">
      <span class="device-name"><slot name="name" /></span>
      <span class="device-sub">{{ sub }}</span>
    </div>
    <slot name="action" />
  </div>
</template>

<script setup lang="ts">
// 設定画面の「名前 + 補足 + 右端アクション」1行（Trusted Devices / API Tokens で共用）。
// name スロット内のタグ等の装飾は呼び出し側の scoped CSS が持つ。
defineProps({
  sub: { type: String, default: "" },
});
</script>

<style scoped>
.device-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}

.device-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.device-name {
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.device-sub {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
