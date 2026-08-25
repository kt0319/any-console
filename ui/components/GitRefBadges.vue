<template>
  <span v-if="refs.length" class="git-log-entry-refs">
    <span v-for="r in refs" :key="r.label" class="git-ref" :class="'git-ref-' + r.type" :data-tooltip="r.label"><span v-if="r.synced" class="mdi mdi-link-variant"></span><span :class="'mdi ' + r.icon"></span><span class="git-ref-text"><span v-if="abbreviateRef(r).abbr" class="branch-abbr">{{ abbreviateRef(r).abbr }}</span>{{ abbreviateRef(r).rest }}</span></span>
  </span>
</template>

<script setup lang="ts">
import type { PropType } from "vue";
import { useIsMobile } from "../composables/useIsMobile.ts";
import { abbreviateBranch } from "../utils/git.ts";

// コミット行の refs バッジ列（HEAD / ブランチ / リモート / タグ）。
// GitHistory の選択コミットヘッダーとコミット一覧行で共用する。
//
// git.ts の GitRef（type がリテラルUnion）と useGitLogPagination 経由の
// GitGraphEntry.refs（type が string に広がったローカル型）の両方を受けるため、
// 最小限のフィールドだけを要求する形にする。
type RefLike = { type: string, label: string, icon?: string, synced?: boolean };

defineProps({
  refs: { type: Array as PropType<RefLike[]>, default: () => [] },
});

const { isMobile } = useIsMobile();

function abbreviateRef(r: RefLike) {
  if (r.type === "tag" || !isMobile.value || r.label.length < 24) return { abbr: "", rest: r.label };
  return abbreviateBranch(r.label);
}
</script>

<style scoped>
.git-log-entry-refs {
  display: flex;
  gap: 4px;
  flex-wrap: nowrap;
}

.branch-abbr {
  color: #fff;
  font-weight: 500;
}
</style>
