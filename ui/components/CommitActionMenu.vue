<template>
  <div class="commit-action-menu">
    <button type="button" class="modal-action-btn" @click="$emit('exec', { action: 'cherry-pick' })">cherry-pick</button>
    <button type="button" class="modal-action-btn" @click="$emit('exec', { action: 'revert' })">revert</button>
    <button type="button" class="modal-action-btn" @click="$emit('exec', { action: 'branch' })">branch</button>
    <button
      v-for="b in branches"
      :key="'merge-' + b"
      type="button"
      class="modal-action-btn"
      @click="$emit('exec', { action: 'merge', branch: b })"
    >merge {{ b }}</button>
    <button
      v-for="b in branches"
      :key="'rebase-' + b"
      type="button"
      class="modal-action-btn"
      @click="$emit('exec', { action: 'rebase', branch: b })"
    >rebase {{ b }}</button>
    <button type="button" class="modal-action-btn" @click="$emit('exec', { action: 'reset', mode: 'soft' })">reset --soft</button>
    <button type="button" class="modal-action-btn commit-action-danger" @click="$emit('exec', { action: 'reset', mode: 'hard' })">reset --hard</button>
  </div>
</template>

<script setup>
defineProps({
  branches: { type: Array, default: () => [] },
});

defineEmits(["exec"]);
</script>
