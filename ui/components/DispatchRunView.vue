<template>
  <div class="modal-scroll-body">
    <div class="dispatch-run-header">
      <button type="button" class="dispatch-run-back-btn" aria-label="Back to dispatch list" data-tooltip="Back" @click="emits('back')">
        <span class="mdi mdi-arrow-left"></span>
      </button>
      <span class="dispatch-run-title">{{ isRerun ? "Rerun Dispatch" : "Run Dispatch" }}</span>
    </div>
    <div v-if="request" class="ws-settings-section">
      <div class="ws-settings-row">
        <span class="ws-settings-label">Session</span>
        <select v-model="selectedSessionId" class="form-input" :disabled="isAsyncPending(sessionsState) || selectedCreateWorktree">
          <option :value="NEW_SESSION_VALUE">+ New session</option>
          <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
            {{ s.workspace ? `${s.workspace} / ${s.job_label || s.job_name || 'Terminal'}` : (s.job_label || s.job_name || 'Terminal') }}{{ s.session_id === currentSessionId ? ' (this session)' : '' }}
          </option>
        </select>
      </div>

      <div class="ws-settings-row">
        <span class="ws-settings-label">Workspace</span>
        <select v-model="selectedWorkspace" class="form-input" :disabled="!isNewSession">
          <option v-for="w in workspaceOptions" :key="w.name" :value="w.name">{{ w.name }}</option>
        </select>
      </div>
      <dl v-if="showWorktreeInfo" class="dispatch-run-meta">
        <dt>Worktree</dt>
        <dd>{{ request.worktree }}</dd>
      </dl>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Job</span>
        <select v-model="selectedJob" class="form-input" :disabled="!isNewSession">
          <option value="terminal">Terminal</option>
          <option v-for="job in jobs" :key="job.key" :value="job.key">
            {{ job.label }}
          </option>
        </select>
      </div>

      <template v-if="hasBranchField">
        <div class="ws-settings-row" style="gap:8px">
          <label class="form-check-label"><input type="radio" v-model="createMode" value="" /> Change branch</label>
          <label class="form-check-label"><input type="radio" v-model="createMode" value="branch" /> Create branch</label>
          <label class="form-check-label"><input type="radio" v-model="createMode" value="worktree" /> Create worktree</label>
        </div>
        <div v-if="createMode" class="ws-settings-row">
          <span class="ws-settings-label">New branch</span>
          <input
            v-model="newBranchName"
            type="text"
            class="form-input"
            placeholder="New branch name"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">{{ createMode ? "Base branch" : "Branch" }}</span>
          <select v-model="branchSelectValue" class="form-input">
            <option value="">{{ currentBranchLabel }}</option>
            <option v-for="b in selectableBranches" :key="b" :value="b">{{ b }}</option>
            <option v-for="b in selectableRemoteBranches" :key="`remote:${b}`" :value="b">{{ b }} (remote)</option>
          </select>
        </div>
      </template>

      <div class="ws-settings-row ws-settings-row-stack">
        <span class="ws-settings-label">Input</span>
        <textarea
          v-model="text"
          class="form-input dispatch-run-input"
          rows="4"
          autocomplete="off"
          spellcheck="false"
          @paste="onImagePaste"
        ></textarea>
        <template v-if="imagePaths.length">
          <ul class="dispatch-run-image-list">
            <li v-for="path in imagePaths" :key="path" class="dispatch-run-image-chip">
              <img v-if="previewUrls[path]" :src="previewUrls[path]" class="dispatch-run-image-thumb" alt="" />
              <span class="dispatch-run-image-name">{{ path.split('/').pop() }}</span>
              <button
                type="button"
                class="dispatch-run-image-remove"
                aria-label="Remove image"
                data-tooltip="Remove image"
                @click="removeImage(path)"
              >
                <span class="mdi mdi-close"></span>
              </button>
            </li>
          </ul>
          <p class="dispatch-run-image-hint">Images are sent as file path references appended to the text, not as binary data.</p>
        </template>
        <p v-else-if="imagesExpired" class="dispatch-run-image-hint">Attached images have expired and were removed.</p>
      </div>

      <div v-if="missingBranchBlockReason" class="job-config-error">{{ missingBranchBlockReason }}</div>
      <div v-if="dirtyBlockReason" class="job-config-error">{{ dirtyBlockReason }}</div>

      <div class="ws-settings-row" style="gap:8px">
        <button
          type="button"
          class="primary"
          :disabled="running || infoLoading || !!dirtyBlockReason || !!missingBranchBlockReason || (selectedCreateWorktree && !newBranchName.trim())"
          @click="run"
        >
          <span class="mdi mdi-play"></span> {{ running ? "Running..." : "Run" }}
        </button>
      </div>
      <div v-if="runError" class="job-config-error">{{ runError }}</div>
    </div>

    <div v-if="request && !isRerun" class="ws-settings-section ws-delete-section">
      <button type="button" class="ws-delete-btn" :disabled="discarding" @click="discard">
        <span class="mdi mdi-close"></span>
        {{ discarding ? "Discarding..." : "Discard dispatch" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, type PropType } from "vue";
import { useApi } from "../composables/useApi.ts";
import { useDispatchImagePaste } from "../composables/useDispatchImagePaste.ts";
import { useDispatchQueue } from "../composables/useDispatchQueue.ts";
import { useDispatchRunBranchGuard } from "../composables/useDispatchRunBranchGuard.ts";
import { useDispatchRunOptions } from "../composables/useDispatchRunOptions.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { EP_TERMINAL_SESSIONS } from "../utils/endpoints.ts";
import { dispatchWorkspaceLabel } from "../utils/dispatch-request.ts";
import { buildDispatchOverrides } from "../utils/dispatch-run.ts";
import { useBusListener } from "../composables/useBusListener.ts";
import { type AsyncState, asyncError, asyncIdle, asyncLoading, asyncReady, asyncValueOr, isAsyncPending } from "../utils/async-state.ts";

const NEW_SESSION_VALUE = "__new_session__";

// WorkspaceDetail.vueのDispatchタブ内のローカル遷移。pushViewスタックに乗せるとサイドバー側に別レイヤーで出る。
const props = defineProps({
  itemId: { type: String, required: true },
  // dispatchピルを押したタブ自身のsessionId。existing_session_idが無い場合のSession選択デフォルト。
  preferredSessionId: { type: String as PropType<string | null>, default: null },
  // Run後に本コンポーネントが破棄されemitがVueに捨てられるため、親ダイアログを閉じる通知は関数propで行う。
  afterRun: { type: Function as PropType<() => void>, default: undefined },
});
const emits = defineEmits(["back"]);

const { apiGet, apiCommand, wsEndpoint } = useApi();
const { queue, recent, runItem, discardItem } = useDispatchQueue();
const { imagePaths, previewUrls, onPaste: onImagePaste, removeImage } = useDispatchImagePaste();
const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
const currentSessionId = computed(() => terminalStore.activeTab?.sessionId || null);

const itemId = props.itemId;
// 承認待ち(queue)優先、無ければ履歴(recent)から探す。recent由来は再実行モード(isRerun)でDiscardを出さない。
const queueItem = computed(() => queue.value.find((q) => q.id === itemId) || null);
const recentItem = computed(() => queueItem.value ? null : (recent.value.find((r) => r.id === itemId) || null));
const item = computed(() => queueItem.value || recentItem.value);
const request = computed(() => item.value?.request || null);
const isRerun = computed(() => !queueItem.value && !!recentItem.value);

const branch = ref("");
// Change branchのbranchとは別refにする（共用すると戻った時に自由入力が切替先として誤読される）。
const newBranchName = ref("");
const baseBranch = ref("");
const text = ref("");
const selectedWorkspace = ref("");
const selectedJob = ref("terminal");
const selectedSessionId = ref(NEW_SESSION_VALUE);
// worktreeは新規ブランチ前提のためCreate branchと両立しない。
const createMode = ref("");
const selectedCreateBranch = computed(() => createMode.value === "branch");
const selectedCreateWorktree = computed(() => createMode.value === "worktree");
const isNewSession = computed(() => selectedSessionId.value === NEW_SESSION_VALUE);

const effectiveBranch = computed(() => (createMode.value !== "" ? newBranchName.value : branch.value));

const sessionsState = ref<AsyncState<Record<string, any>[]>>(asyncIdle());
const sessions = computed(() => asyncValueOr(sessionsState.value, [] as Record<string, any>[]));
const running = ref(false);
const discarding = ref(false);
const runError = ref("");
// TTL経過でサーバが添付画像を削除したRecent item（sweep_expired_dispatch_images参照）。
const imagesExpired = ref(false);

function initFromRequest(req: Record<string, any> | null) {
  // create_branch時のbranchは「新規ブランチ名」、それ以外は「切替先ブランチ」を意味する。
  if (req?.create_branch) {
    newBranchName.value = req?.branch || "";
    branch.value = "";
  } else {
    branch.value = req?.branch || "";
    newBranchName.value = "";
  }
  baseBranch.value = req?.base_branch || "";
  text.value = req?.text || "";
  imagePaths.value = Array.isArray(req?.image_paths) ? [...req.image_paths] : [];
  imagesExpired.value = !!req?.images_expired;
  selectedWorkspace.value = req?.workspace || "";
  selectedJob.value = req?.job || "terminal";
  selectedSessionId.value = req?.existing_session_id || props.preferredSessionId || NEW_SESSION_VALUE;
  createMode.value = req?.create_branch ? "branch" : "";
}

// 新規セッションにworktreeは選べない。既存セッション選択時はそのworkspaceがworktreeのこともあるため、一覧に無ければ表示専用で追加する。
const workspaceOptions = computed(() => {
  const opts = workspaceStore.allWorkspaces.filter((w) => !w.worktree);
  if (!isNewSession.value && selectedWorkspace.value && !opts.some((w) => w.name === selectedWorkspace.value)) {
    const current = workspaceStore.allWorkspaces.find((w) => w.name === selectedWorkspace.value);
    if (current) opts.push(current);
  }
  return opts;
});
const showWorktreeInfo = computed(() => !!request.value?.worktree && selectedWorkspace.value === request.value?.workspace);

// worktree上のdispatchはブランチ固定のためブランチ操作項目を出さない。
const hasBranchField = computed(() => !request.value?.worktree);

// Session/Job/Branchが未取得・取得中の間はRunを押させない（古い選択肢でdispatchする事故防止）。error時は永久disabledを避けるためブロックしない。
const infoLoading = computed(() => {
  if (isAsyncPending(sessionsState.value) || isAsyncPending(jobsState.value)) return true;
  if (hasBranchField.value && isAsyncPending(branchesState.value)) return true;
  return false;
});

// dedup_keyによる置換はdispatch_idを維持しitemRemovedが発火しない。retry_count変化で別の失敗に置き換わったことを検知し、古い内容を承認させないよう閉じる。
const initialRetryCount = ref<number | null>(null);

onMounted(() => {
  if (!item.value) { emits("back"); return; }
  initFromRequest(request.value);
  initialRetryCount.value = request.value?.retry_count ?? 1;
});

// 実行に失敗した項目は同じIDで履歴（failed）へ移るので、画面を閉じずに再実行モードとして続ける。
useBusListener("dispatch:itemRemoved", ({ id }) => {
  if (id !== itemId) return;
  if (recent.value.some((r) => r.id === itemId && r.outcome === "failed")) return;
  emits("back");
});

watch(() => request.value?.retry_count, (count) => {
  if (initialRetryCount.value !== null && count !== undefined && count !== initialRetryCount.value) {
    emits("back");
  }
});

onMounted(() => {
  sessionsState.value = asyncLoading();
  apiGet(EP_TERMINAL_SESSIONS).then((res) => {
    if (res.ok && Array.isArray(res.data)) {
      const list = res.data.filter((s) => !s.detached);
      sessionsState.value = asyncReady(list);
      // 記録時のexisting_session_idは実行時に閉じ/detach済みで選択肢に無いことがあり、selectが空欄になるため+ New sessionへ戻す。
      if (selectedSessionId.value !== NEW_SESSION_VALUE
          && !list.some((s) => s.session_id === selectedSessionId.value)) {
        selectedSessionId.value = NEW_SESSION_VALUE;
      }
    } else {
      sessionsState.value = asyncError("Failed to load sessions");
    }
  });
});

// 新規worktreeは新規セッションでしか使えない（既存セッションだと入力が別ディレクトリへ送られる）。
watch(selectedCreateWorktree, (creating) => {
  if (creating) selectedSessionId.value = NEW_SESSION_VALUE;
});

// 既存セッション選択時はそのセッションの実Workspace/Jobをプレビューに反映し、新規に戻したら元のリクエスト値へ戻す。
watch(selectedSessionId, (id) => {
  if (id === NEW_SESSION_VALUE) {
    selectedWorkspace.value = request.value?.workspace || "";
    selectedJob.value = request.value?.job || "terminal";
    return;
  }
  const s = sessions.value.find((s) => s.session_id === id);
  if (!s) return;
  selectedWorkspace.value = s.workspace || selectedWorkspace.value;
  selectedJob.value = s.job_name || "terminal";
});

const baseBranchWorkspace = computed(() => {
  if (!isNewSession.value && selectedSessionId.value) {
    const s = sessions.value.find((s) => s.session_id === selectedSessionId.value);
    return s?.workspace || request.value?.workspace;
  }
  return selectedWorkspace.value;
});

const { jobsState, jobs, branchesState, localBranches, remoteOnlyBranches } = useDispatchRunOptions({
  jobWorkspace: selectedWorkspace,
  selectedJob,
  branchWorkspace: baseBranchWorkspace,
  baseBranch,
});

const { branchSelectValue, currentBranchLabel, selectableBranches, selectableRemoteBranches, missingBranchBlockReason, dirtyBlockReason } = useDispatchRunBranchGuard({
  selectedWorkspace,
  createMode,
  newBranchName,
  branch,
  baseBranch,
  hasBranchField,
  branchesState,
  localBranches,
  remoteOnlyBranches,
});

async function run() {
  if (running.value || !itemId) return;
  running.value = true;
  runError.value = "";
  try {
    const overrides = buildDispatchOverrides(request.value || {}, {
      workspace: selectedWorkspace.value,
      branch: effectiveBranch.value,
      baseBranch: baseBranch.value,
      text: text.value,
      job: selectedJob.value,
      isNewSession: isNewSession.value,
      sessionId: selectedSessionId.value,
      createBranch: selectedCreateBranch.value,
      imagePaths: imagePaths.value,
    });
    if (selectedCreateWorktree.value) {
      // worktreeはGitChangeBranch.vueのAdd > Worktreeと同じAPIで先に作り、"{base}:{branch}"をworkspaceとして使う（dispatch側のworktreeフィールドは既存worktree検索専用）。
      const { ok, data } = await apiCommand(
        wsEndpoint(selectedWorkspace.value, "worktrees"),
        { branch: newBranchName.value.trim(), base: baseBranch.value || null },
        { errorMessage: "Failed to create worktree" },
      );
      if (!ok) return;
      const createdName = data?.workspace?.name;
      if (!createdName) return;
      await workspaceStore.fetchWorkspaces();
      overrides.workspace = createdName;
      overrides.branch = null;
      overrides.base_branch = null;
      overrides.create_branch = null;
      // worktree作成後はモーダルを閉じ、実行はバックグラウンドで継続する。失敗はrunItem内のapiPostがトーストで通知する。
      props.afterRun?.();
      runItem(itemId, overrides).catch(() => {});
      return;
    }
    const ok = await runItem(itemId, overrides);
    // Run成功後はセッションを見せたいので、一覧へ戻さずワークスペース詳細ごと閉じる。
    if (ok) props.afterRun?.();
  } finally {
    running.value = false;
  }
}

async function discard() {
  if (discarding.value || !itemId) return;
  discarding.value = true;
  try {
    if (await discardItem(itemId, dispatchWorkspaceLabel(request.value))) emits("back");
  } finally {
    discarding.value = false;
  }
}
</script>

<style scoped>
/* ワークスペース詳細のDispatchタブ内での一覧への戻り導線 */
.dispatch-run-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 8px;
}

.dispatch-run-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-primary);
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-run-back-btn:hover {
    background: var(--bg-tertiary);
  }
}

.dispatch-run-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

/* "Base branch" 等の長いラベルに合わせて列幅を揃える（Session/Workspace/Job と同じ開始位置にする）。 */
.ws-settings-label {
  min-width: 84px;
}

.dispatch-run-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 13px;
  padding: 0 4px;
}
.dispatch-run-meta dt {
  color: var(--text-secondary);
}
.dispatch-run-meta dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
}
.dispatch-run-input {
  resize: vertical;
  font-family: monospace;
}

.dispatch-run-image-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dispatch-run-image-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.dispatch-run-image-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 4px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  font-size: 12px;
  color: var(--text-primary);
  max-width: 220px;
}

.dispatch-run-image-thumb {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}

.dispatch-run-image-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dispatch-run-image-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-run-image-remove:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
}
</style>
