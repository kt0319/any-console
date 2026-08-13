<template>
  <div
    class="pill-chip pill-peek-wide"
    :class="colorClass"
    role="button"
    tabindex="0"
    @pointerdown.stop
    @click.stop="emits('peek-click')"
    @keydown.enter.stop.prevent="emits('peek-click')"
    @keydown.space.stop.prevent="emits('peek-click')"
  >
    <span
      v-if="peekingKey === 'workspace' && (tab.wsIcon || tab.icon)"
      class="pill-peek-icon-slot"
      v-html="renderIconStr((tab.wsIcon || tab.icon).name, (tab.wsIcon || tab.icon).color, 16)"
    ></span>
    <span v-else class="mdi pill-peek-icon" :class="iconClass"></span>
    <span class="pill-peek-text pill-peek-marquee" :style="{ maxWidth: maxWidth + 'px' }">
      <span
        :ref="setMarqueeTextEl"
        class="pill-peek-marquee-text"
        :class="{ 'pill-peek-marquee-run': marqueeRun }"
        :style="marqueeRun ? { animationDuration: marqueeDurationMs + 'ms', '--pill-peek-marquee-offset': marqueeOffset + 'px' } : null"
      >
        <template v-if="peekingKey === 'changes'">
          <span v-if="changedFiles > 0" class="pill-peek-changes-files">{{ changedFiles }}F</span>
          <span class="pill-peek-changes-plus">+{{ insertions }}</span>
          <span class="pill-peek-changes-minus">-{{ deletions }}</span>
        </template>
        <template v-else-if="peekingKey === 'branch'">
          {{ branchName }}<span v-if="ahead > 0" class="pill-peek-branch-ahead"> ↑{{ ahead }}</span><span v-if="behind > 0" class="pill-peek-branch-behind"> ↓{{ behind }}</span><span v-if="pushCount > 0" class="pill-peek-branch-done pill-peek-branch-push-done"> {{ pushCount }} Pushed</span><span v-if="pullCount > 0" class="pill-peek-branch-done pill-peek-branch-pull-done"> {{ pullCount }} Pulled</span>
        </template>
        <template v-else-if="peekingKey === 'actions'">
          <span class="pill-peek-actions-name">[{{ actionName }}]</span> <span class="pill-peek-actions-status">{{ actionStatusText }}</span>
        </template>
        <template v-else>{{ text }}</template>
      </span>
    </span>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { PILL_PEEK_DURATION_MS, PILL_MARQUEE_END_HOLD_MS } from "../utils/constants.ts";

// ピルの値が変化した時に一時表示する1本の長いピル（.pill-peek-wide）。
// 何をどの色・テキストで出すか（colorClass/iconClass/text/signature）は
// 親（TerminalPane）が組み立て、このコンポーネントは表示とマーキー判定だけを
// 受け持つ。スタイルは ui/styles/info-pills.css（グローバル）。

const props = defineProps({
  peekingKey: { type: String, required: true },
  colorClass: { type: [String, Array], default: "" },
  iconClass: { type: String, default: "" },
  text: { type: String, default: "" },
  // 内容が変化した時だけマーキーを再測定するための、キーごとの比較用シグネチャ。
  signature: { type: String, default: null },
  tab: { type: Object, required: true },
  maxWidth: { type: Number, required: true },
  changedFiles: { type: Number, default: 0 },
  insertions: { type: Number, default: 0 },
  deletions: { type: Number, default: 0 },
  branchName: { type: String, default: "" },
  ahead: { type: Number, default: 0 },
  behind: { type: Number, default: 0 },
  pushCount: { type: Number, default: 0 },
  pullCount: { type: Number, default: 0 },
  actionName: { type: String, default: "" },
  actionStatusText: { type: String, default: "" },
  // このpeekが実際に表示される時間（usePillPeek.js参照。キューで分割
  // された場合はPILL_PEEK_DURATION_MSより短い）。
  peekDurationMs: { type: Number, default: PILL_PEEK_DURATION_MS },
});

// マーキーの再生時間を表示時間ぴったりにすると、流れ終わった瞬間に
// ピルごと消えて最後まで読めない。PILL_MARQUEE_END_HOLD_MSぶん短くし、
// 末尾が見えた状態で少し静止してから消えるようにする。
const marqueeDurationMs = computed(() => Math.max(500, props.peekDurationMs - PILL_MARQUEE_END_HOLD_MS));

const emits = defineEmits(["peek-click"]);

// peekピルのラベルがピル幅に収まっている時はマーキーで流さない（収まって
// いるのに動かすと落ち着かないため）。収まらない時だけ、先頭の文字が
// ピル端に見えている状態からスタートし、末尾が見えたところで止める
// 1回きりのスクロールにする（.pill-peek-marquee-run、infiniteループは
// しない）。History以外の全ラベルにも同じ扱いを揃える。
const marqueeRun = ref(false);
const marqueeTextEl = ref(null);
// はみ出し幅（scrollWidth - clientWidth）。末尾がちょうど見える位置で
// 止まるよう、アニメーションの移動量をこの実測値に合わせる。
const marqueeOffset = ref(0);

function measureMarquee() {
  const el = marqueeTextEl.value;
  const container = el?.parentElement;
  const overflow = container ? el.scrollWidth - container.clientWidth : 0;
  marqueeRun.value = overflow > 0;
  marqueeOffset.value = Math.max(0, overflow);
}

// peekピルは Transition(mode="out-in") 配下にあり、キー切替時は旧要素の
// leaveアニメーション完了を待ってから新要素がDOMへ挿入される。signature
// の変化を起点に nextTick() だけで測るとこの挿入待ちより早く走ってしまい、
// marqueeTextEl がまだ null/旧要素のままで測定に失敗する（挿入後は再測定
// されず、動くべき時に動かないまま固定される）。実際にDOMへ挿入された瞬間
// （関数refのマウント時）にも測るようにして、このレースを避ける。
function setMarqueeTextEl(el) {
  marqueeTextEl.value = el;
  if (el) nextTick(measureMarquee);
}

watch(
  () => props.signature,
  async (sig) => {
    if (!sig) { marqueeRun.value = false; return; }
    marqueeRun.value = false;
    await nextTick();
    if (marqueeTextEl.value) measureMarquee();
  },
);
</script>
