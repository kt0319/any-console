import { on, emit } from "../app-bridge.js";
import { useApi } from "./useApi.js";
import { EP_RUN } from "../utils/endpoints.js";

/**
 * App.vue のルートで購読する job:* イベントのハンドラ。
 * - job:run: hidden_tab=false なら非ターミナル実行、それ以外は terminal:launch
 * - job:exec: 強制的に非ターミナル実行
 */
export function useAppJobBridge() {
  const { apiPost } = useApi();

  async function execNonTerminalJob(jobName, workspace) {
    const { ok, data } = await apiPost(EP_RUN, { job: jobName, workspace }, { errorMessage: "Job failed" });
    if (!ok) return;
    const msg = data?.stdout || data?.stderr || "Done";
    emit("toast:show", { message: msg, type: data?.exit_code === 0 ? "success" : "error" });
  }

  function bind() {
    on("job:run", ({ jobName, job, workspace }) => {
      if (job?.hidden_tab === false) {
        execNonTerminalJob(jobName, workspace);
        return;
      }
      emit("terminal:launch", {
        workspace,
        icon: job?.wsIcon,
        iconColor: job?.wsIconColor,
        jobName,
        jobLabel: job?.label,
        jobIcon: job?.icon,
        jobIconColor: job?.icon_color,
        initialCommand: job?.command,
      });
    });
    on("job:exec", ({ jobName, workspace }) => {
      execNonTerminalJob(jobName, workspace);
    });
  }

  return { bind };
}
