<template>
  <BaseModal ref="baseModal" :title="title">
    <div class="args-form">
      <template v-if="args.length > 0">
        <div v-for="arg in args" :key="arg.name" class="arg-group">
          <label class="arg-label">
            {{ arg.name }}
            <span v-if="arg.required" class="required">*</span>
          </label>
          <div v-if="arg.values && arg.values.length > 0" class="radio-group">
            <label v-for="(val, i) in arg.values" :key="val">
              <input
                type="radio"
                :name="`confirm-arg-${arg.name}`"
                :value="val"
                :checked="i === 0"
              />
              <span class="radio-btn">{{ val }}</span>
            </label>
          </div>
        </div>
      </template>
      <pre v-else-if="commandPreview" class="script-preview">{{ commandPreview }}</pre>
    </div>
    <template #actions>
      <button type="button" @click="baseModal?.close()">キャンセル</button>
      <button type="button" class="primary" style="width:auto" @click="run">実行</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref } from "vue";
import BaseModal from "./BaseModal.vue";
import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();
const baseModal = ref(null);
const title = ref("ジョブ実行");
const args = ref([]);
const commandPreview = ref("");
let jobName = "";
let jobData = null;
let workspace = "";

function collectArgs() {
  const result = {};
  for (const arg of args.value) {
    const checked = document.querySelector(`input[name="confirm-arg-${CSS.escape(arg.name)}"]:checked`);
    if (checked) result[arg.name] = checked.value;
  }
  return result;
}

async function open(name, job, ws) {
  jobName = name;
  jobData = job;
  workspace = ws;
  title.value = job.label || name;
  args.value = job.args || [];

  if (args.value.length === 0 && job.command) {
    const cmd = job.command;
    commandPreview.value = cmd.length > 300 ? cmd.slice(0, 300) + "..." : cmd;
  } else if (args.value.length === 0 && !job.command && ws) {
    try {
      const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(ws)}/jobs/${encodeURIComponent(name)}`);
      if (res && res.ok) {
        const detail = await res.json();
        jobData = { ...job, ...detail };
        if (detail.command) {
          const cmd = detail.command;
          commandPreview.value = cmd.length > 300 ? cmd.slice(0, 300) + "..." : cmd;
        }
      }
    } catch {}
  } else {
    commandPreview.value = "";
  }

  baseModal.value?.open();
}

function run() {
  const collectedArgs = collectArgs();
  baseModal.value?.close();
  emit("job:run", { jobName, job: jobData, workspace, args: collectedArgs });
}

function close() {
  baseModal.value?.close();
}

defineExpose({ open, close });
</script>
