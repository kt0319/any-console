import { useConfirm } from "./useConfirm.ts";
import { useRecentJobs } from "./useRecentJobs.ts";
import { emit } from "../app-bridge.ts";
import { jobCommandPreview } from "../utils/format.ts";

export interface RunnableJob {
  name: string;
  label?: string;
  icon?: string;
  icon_color?: string;
  command?: string;
  confirm?: boolean;
  detached?: boolean;
}

export function useRunJob() {
  const { confirm } = useConfirm();
  const { recordJob } = useRecentJobs();

  /** 確認がキャンセルされたら起動せず false を返す。 */
  async function runJobInWorkspace(workspace: Record<string, any>, job: RunnableJob): Promise<boolean> {
    if (job.confirm !== false) {
      const preview = jobCommandPreview(job.command, job.name);
      if (!await confirm(`${job.label || job.name}\n\n${preview}`)) return false;
    }
    recordJob(workspace, job);
    emit("terminal:launch", {
      workspace: workspace.name,
      icon: workspace.icon,
      iconColor: workspace.icon_color,
      jobName: job.name,
      jobLabel: job.label,
      jobIcon: job.icon,
      jobIconColor: job.icon_color,
      initialCommand: job.command,
      detached: !!job.detached,
    });
    return true;
  }

  return { runJobInWorkspace };
}
