<template>
  <div class="modal-scroll-body">
    <div class="settings-section-label">プリセット</div>
    <div class="editor-preset-row">
      <button
        v-for="preset in EDITOR_PRESETS"
        :key="preset.label"
        type="button"
        class="editor-preset-btn"
        :class="{ active: urlTemplate === preset.template }"
        @click="urlTemplate = preset.template"
      >{{ preset.label }}</button>
      <button
        type="button"
        class="editor-preset-btn editor-preset-clear"
        :class="{ active: urlTemplate === '' }"
        @click="urlTemplate = ''"
      >なし</button>
    </div>

    <div class="settings-section-label">URLテンプレート</div>
    <textarea
      ref="textareaRef"
      v-model="urlTemplate"
      class="editor-url-template-input"
      rows="2"
      placeholder="zed://ssh/{user}@{host}{work_dir}/{workspace}"
    />

    <div class="editor-template-chips">
      <button
        v-for="v in TEMPLATE_VARS"
        :key="v"
        type="button"
        class="editor-template-chip"
        @click="insertVar(v)"
      >{{ v }}</button>
    </div>

    <div class="settings-section-label">プレビュー</div>
    <div class="editor-url-preview">{{ previewUrl }}</div>
  </div>
</template>

<script setup>
import { ref, inject, computed, watch, onMounted } from "vue";
import { useAuthStore } from "../stores/auth.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "エディタ";

const auth = useAuthStore();

const EDITOR_PRESETS = [
  { label: "Zed", template: "zed://ssh/{user}@{host}{work_dir}/{workspace}" },
  { label: "VS Code", template: "vscode://vscode-remote/ssh-remote+{host}{work_dir}/{workspace}" },
  { label: "Cursor", template: "cursor://vscode-remote/ssh-remote+{host}{work_dir}/{workspace}" },
];
const TEMPLATE_VARS = ["{user}", "{host}", "{work_dir}", "{workspace}"];

const textareaRef = ref(null);
const urlTemplate = ref("");
const editorUser = ref("");
const editorHost = ref("");
const workDir = ref("");

const previewUrl = computed(() => {
  const tmpl = urlTemplate.value.trim();
  if (!tmpl) return "(エディタボタン非表示)";
  return tmpl
    .replace(/\{user\}/g, editorUser.value || "user")
    .replace(/\{host\}/g, editorHost.value || "host")
    .replace(/\{work_dir\}/g, workDir.value || "/home/user/work")
    .replace(/\{workspace\}/g, "example-workspace");
});

function insertVar(v) {
  const ta = textareaRef.value;
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = urlTemplate.value.slice(0, start);
  const after = urlTemplate.value.slice(end);
  urlTemplate.value = before + v + after;
  const pos = start + v.length;
  ta.focus();
  requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
}

let saveTimer = null;
watch(urlTemplate, (val) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const url_template = val.trim();
    await auth.apiFetch("/settings/editor", { method: "PUT", body: { url_template } });
  }, 500);
});

async function load() {
  try {
    const res = await auth.apiFetch("/system/info");
    if (res && res.ok) {
      const data = await res.json();
      if (data.user) editorUser.value = data.user;
      if (data.hostname) editorHost.value = data.hostname;
      if (data.work_dir) workDir.value = data.work_dir;
    }
  } catch {}
  try {
    const res = await auth.apiFetch("/settings/editor");
    if (res && res.ok) {
      const data = await res.json();
      urlTemplate.value = data.url_template || "";
    }
  } catch {}
}

onMounted(load);
</script>
