import { useConfirm } from "./useConfirm.js";
import { useRecentJobs } from "./useRecentJobs.js";
import { emit } from "../app-bridge.js";

const COMMAND_PREVIEW_LIMIT = 300;

function truncate(command, fallback) {
  if (!command) return fallback;
  return command.length > COMMAND_PREVIEW_LIMIT
    ? command.slice(0, COMMAND_PREVIEW_LIMIT) + "..."
    : command;
}

/**
 * ワークスペース＋ジョブ起動の共通ロジック。
 * confirm が必要なら問い合わせ、recent に記録、terminal:launch を発火する。
 */
export function useJobLauncher() {
  const { confirm } = useConfirm();
  const { recordJob } = useRecentJobs();

  async function runJob(ws, job) {
    emit("modal:close");
    if (job.type === "browser") {
      recordJob(ws, job);
      window.open(job.url, "_blank", "noopener");
      return;
    }
    if (job.confirm !== false) {
      const preview = truncate(job.command, job.name);
      if (!await confirm(`${job.label || job.name}\n\n${preview}`)) return;
    }
    recordJob(ws, job);
    emit("terminal:launch", {
      workspace: ws.name,
      icon: ws.icon,
      iconColor: ws.icon_color,
      jobName: job.name,
      jobLabel: job.label,
      jobIcon: job.icon,
      jobIconColor: job.icon_color,
      initialCommand: job.command,
      hidden: !!job.hidden_tab,
    });
  }

  async function runRecentJob(recent) {
    emit("modal:close");
    if (recent.jobType === "browser") {
      window.open(recent.jobUrl, "_blank", "noopener");
      return;
    }
    if (recent.jobConfirm !== false) {
      const preview = truncate(recent.jobCommand, recent.jobName);
      if (!await confirm(`${recent.jobLabel || recent.jobName}\n\n${preview}`)) return;
    }
    emit("terminal:launch", {
      workspace: recent.workspace,
      icon: recent.wsIcon,
      iconColor: recent.wsIconColor,
      jobName: recent.jobName,
      jobLabel: recent.jobLabel,
      jobIcon: recent.jobIcon,
      jobIconColor: recent.jobIconColor,
      initialCommand: recent.jobCommand,
      hidden: !!recent.jobHiddenTab,
    });
  }

  return { runJob, runRecentJob };
}
