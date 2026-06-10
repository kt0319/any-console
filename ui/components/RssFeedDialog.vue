<template>
  <div class="rss-add-overlay" @click.self="emit('close')">
    <div class="rss-add-dialog">
      <div class="rss-add-title">{{ editingFeed ? "Edit Feed" : "Add RSS / Atom Feed" }}</div>
      <input
        ref="urlInput"
        v-model="url"
        class="rss-add-input"
        type="text"
        placeholder="https://example.com/feed.xml"
        @keydown.enter="emit('submit')"
        @keydown.esc="emit('close')"
      />
      <input
        ref="titleInput"
        v-model="title"
        class="rss-add-input"
        type="text"
        placeholder="Name (optional)"
        @keydown.enter="emit('submit')"
        @keydown.esc="emit('close')"
      />
      <div v-if="error" class="rss-add-error">{{ error }}</div>
      <div class="rss-add-actions">
        <button class="rss-btn rss-btn-cancel" @click="emit('close')">Cancel</button>
        <button class="rss-btn rss-btn-ok" :disabled="submitting" @click="emit('submit')">
          {{ submitting ? "Saving..." : (editingFeed ? "Save" : "Add") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";

const props = defineProps({
  editingFeed: { type: Object, default: null },
  error: { type: String, default: "" },
  submitting: { type: Boolean, default: false },
});

const emit = defineEmits(["submit", "close"]);

const url = defineModel("url", { default: "" });
const title = defineModel("title", { default: "" });

const urlInput = ref(null);
const titleInput = ref(null);

onMounted(() => {
  if (props.editingFeed) {
    urlInput.value?.select();
  } else {
    urlInput.value?.focus();
  }
});
</script>

<style scoped>
.rss-add-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.rss-add-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  width: min(320px, 90%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rss-add-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.rss-add-input {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 13px;
  padding: 8px 10px;
  width: 100%;
  box-sizing: border-box;
}

.rss-add-input:focus {
  outline: none;
  border-color: var(--accent);
}

.rss-add-error {
  font-size: 12px;
  color: var(--error);
}

.rss-add-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.rss-btn {
  font-size: 13px;
  padding: 6px 16px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid var(--border);
}

.rss-btn-cancel {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.rss-btn-ok {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.rss-btn-ok:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
