<template>
  <div
    class="pill-trailing"
    :style="{ maxWidth: maxWidth + 'px' }"
  >
    <div class="pill-trailing-inner">
        <template v-for="key in infoPillConfig.order" :key="key">
        <button
          v-if="key === 'files' && (isGitRepo || tab.sessionId) && infoPillConfig.files"
          type="button"
          class="pill-chip pill-devserver-btn pill-files-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.files"
          :data-tooltip="tooltips.files"
          @pointerdown.stop
          @click.stop="emits('open', 'files')"
        >
          <span v-if="tab.wsIcon" class="pill-icon-badge-wrap">
            <span v-html="renderIconStr(tab.wsIcon.name, tab.wsIcon.color, 16)"></span>
            <span v-if="isDirty" class="pill-dirty-badge" aria-label="uncommitted changes"></span>
          </span>
          <span v-else-if="tab.icon" class="pill-icon-slot pill-icon-badge-wrap">
            <span v-html="renderIconStr(tab.icon.name, tab.icon.color, 16)"></span>
            <span v-if="isDirty" class="pill-dirty-badge" aria-label="uncommitted changes"></span>
          </span>
          <span v-else class="mdi" :class="peekIconForKey('files')"></span>
        </button>
        <button
          v-else-if="key === 'history' && isGitRepo && infoPillConfig.history"
          type="button"
          class="pill-chip pill-devserver-btn pill-history-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.history"
          :data-tooltip="tooltips.history"
          @pointerdown.stop
          @click.stop="emits('open', 'history')"
        >
          <span class="mdi" :class="peekIconForKey('history')"></span>
        </button>
        <button
          v-else-if="key === 'changes' && isGitRepo && isDirty && infoPillConfig.changes"
          type="button"
          class="pill-chip pill-numstat-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.changes"
          :data-tooltip="tooltips.changes"
          @pointerdown.stop
          @click.stop="emits('open', 'changes')"
        >
          <span class="mdi" :class="peekIconForKey('changes')"></span>
        </button>
        <button
          v-else-if="key === 'branch' && isGitRepo && infoPillConfig.branch"
          type="button"
          class="pill-chip pill-branch-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.branch"
          :data-tooltip="tooltips.branch"
          @pointerdown.stop
          @click.stop="emits('open', 'branch')"
        >
          <span class="mdi" :class="peekIconForKey('branch')"></span>
          <span v-if="ahead > 0" class="pill-branch-count push-count"><span class="mdi mdi-arrow-up-thin"></span>{{ ahead }}</span>
          <span v-if="behind > 0" class="pill-branch-count pull-count"><span class="mdi mdi-arrow-down-thin"></span>{{ behind }}</span>
        </button>
        <button
          v-else-if="key === 'prs' && hasPr && infoPillConfig.prs"
          type="button"
          class="pill-chip pill-devserver-btn pill-pr-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.prs"
          :data-tooltip="tooltips.prs"
          @pointerdown.stop
          @click.stop="emits('open', 'prs')"
        >
          <span class="mdi" :class="peekIconForKey('prs')"></span>
        </button>
        <button
          v-else-if="key === 'actions' && hasAction && infoPillConfig.actions"
          type="button"
          class="pill-chip pill-devserver-btn pill-actions-btn"
          :class="[actionStatusClass, pillActivityClass]"
          :aria-label="tooltips.actions"
          :data-tooltip="tooltips.actions"
          @pointerdown.stop
          @click.stop="emits('open', 'actions')"
        >
          <span class="mdi" :class="actionStatusIcon"></span>
        </button>
        <button
          v-else-if="key === 'devserver' && hasDevServer && infoPillConfig.devserver"
          type="button"
          class="pill-chip pill-devserver-btn pill-server-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.devserver"
          :data-tooltip="tooltips.devserver"
          @pointerdown.stop
          @click.stop="emits('open', 'devserver')"
        >
          <span class="mdi" :class="peekIconForKey('devserver')"></span>
        </button>
        <button
          v-else-if="key === 'add' && !tab.workspace && tab.sessionId && infoPillConfig.add"
          type="button"
          class="pill-chip pill-devserver-btn pill-add-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.add"
          :data-tooltip="tooltips.add"
          @pointerdown.stop
          @click.stop="emits('open', 'add')"
        >
          <span class="mdi" :class="peekIconForKey('add')"></span>
        </button>
        <button
          v-else-if="key === 'dispatch' && dispatchCount > 0 && infoPillConfig.dispatch"
          type="button"
          class="pill-chip pill-devserver-btn pill-dispatch-btn"
          :class="pillActivityClass"
          :aria-label="tooltips.dispatch"
          :data-tooltip="tooltips.dispatch"
          @pointerdown.stop
          @click.stop="emits('open', 'dispatch')"
        >
          <span class="mdi" :class="peekIconForKey('dispatch')"></span>
          <span v-if="dispatchCount > 1" class="pill-branch-count">{{ dispatchCount }}</span>
        </button>
        </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { renderIconStr } from "../utils/render-icon.js";
import { peekIconForKey } from "../utils/info-pills.js";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
import { useTerminalStore } from "../stores/terminal.js";

// ターミナルペイン右上のアイコンピル群（Info Pills）。表示条件・並び順は
// 設定（infoPillConfig）と親から渡される現在値に従う。ピルのキーごとの
// 表示条件は trailingPeekItems（TerminalPane.vue）の各キーの条件と
// 揃えること（揃えないと、非表示ピルの変化が別ピルのpeek枠を奪う）。
// クリックは open(key) を emit し、遷移は親（useInfoPillActions）が担う。
// スタイルは ui/styles/info-pills.css（グローバル）。

const props = defineProps({
  tab: { type: Object, required: true },
  maxWidth: { type: Number, required: true },
  isGitRepo: { type: Boolean, default: false },
  isDirty: { type: Boolean, default: false },
  ahead: { type: Number, default: 0 },
  behind: { type: Number, default: 0 },
  hasPr: { type: Boolean, default: false },
  hasAction: { type: Boolean, default: false },
  hasDevServer: { type: Boolean, default: false },
  dispatchCount: { type: Number, default: 0 },
  actionStatusClass: { type: String, default: "" },
  actionStatusIcon: { type: String, default: "" },
  // キーごとのツールチップ文言（ui/utils/info-pill-tooltips.js で組み立て）。
  tooltips: { type: Object, required: true },
});

const emits = defineEmits(["open"]);

const infoPillConfig = useInfoPillConfigStore();
const terminalStore = useTerminalStore();

const agentState = computed(() => terminalStore.agentStates[props.tab.sessionId] || "");
// 新規出力通知(tab-activity)・エージェント実行中(pill-working)・承認待ち
// (pill-blocked)のアニメーションは特定のピルに限らず、全ピル共通の見た目にする。
const pillActivityClass = computed(() => ({
  "tab-activity": props.tab._activity,
  "pill-working": agentState.value === "working",
  "pill-blocked": agentState.value === "blocked",
}));
</script>
