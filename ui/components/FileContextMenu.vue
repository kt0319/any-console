<template>
  <li
    class="file-browser-action-menu"
    @mouseenter="$emit('menu-enter')"
    @mouseleave="$emit('menu-leave')"
  >
    <button v-if="!isHoverDevice" type="button" @click="$emit('open')"><span class="mdi mdi-open-in-app"></span> Open</button>
    <button v-if="isFile" type="button" @click="$emit('editor')"><span class="mdi mdi-file-edit-outline"></span> Editor</button>
    <button v-if="isFile" type="button" @click="$emit('history')"><span class="mdi mdi-history"></span> History</button>
    <button v-if="isFile" type="button" @click="$emit('download')"><span class="mdi mdi-download"></span> Download</button>
    <button v-if="githubUrl" type="button" @click="$emit('github')"><span class="mdi mdi-github"></span> GitHub</button>
    <button type="button" @click="$emit('rename')"><span class="mdi mdi-rename-box"></span> Rename</button>
    <button type="button" @click="$emit('move')"><span class="mdi mdi-file-move-outline"></span> Move</button>
    <button type="button" class="file-browser-action-delete" @click="$emit('delete')"><span class="mdi mdi-delete-outline"></span> Delete</button>
  </li>
</template>

<script setup>
import { isHoverDevice } from "../composables/useHoverMenu.js";

defineProps({
  isFile: { type: Boolean, required: true },
  githubUrl: { type: String, default: "" },
});

defineEmits(["open", "editor", "history", "download", "github", "rename", "move", "delete", "menu-enter", "menu-leave"]);
</script>
