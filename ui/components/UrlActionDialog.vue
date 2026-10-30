<template>
  <!-- ターミナルURLアクションダイアログ -->
  <BaseDialog :visible="!!terminalUrl" :z-index="DIALOG_Z_INDEX_TOP" @dismiss="terminalUrl = ''">
    <div class="dialog-box" style="--dialog-width: 480px" role="dialog" aria-modal="true" aria-label="Open URL">
      <div class="dialog-title">Open URL</div>
      <DialogCopyField :value="terminalUrl" label="URL" />
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-cancel" @click="terminalUrl = ''">Cancel</button>
        <button class="dialog-btn dialog-btn-ok" @click="doUrlOpen">
          <span class="mdi mdi-open-in-new"></span>Open
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { DIALOG_Z_INDEX_TOP } from "../utils/constants.ts";
import { ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import DialogCopyField from "./DialogCopyField.vue";
import { useBusListener } from "../composables/useBusListener.ts";
import { openExternal } from "../utils/open-external.ts";

const terminalUrl = ref("");

function doUrlOpen() {
  openExternal(terminalUrl.value);
  terminalUrl.value = "";
}

useBusListener("terminal:url", ({ uri }) => { terminalUrl.value = uri; });
</script>
