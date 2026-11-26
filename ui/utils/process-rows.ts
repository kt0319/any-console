// Server Processes ページの行構築（ServerProcessesView.vue から使用）。dev server / job / 通常プロセスを
// ps の並び順のまま1本のリストへ合成する純粋関数。テストは tests/ui/test_process_rows.js。

export type ProcessEntry = { name: string, pid: number, cpu: number, mem: number };
export type JobEntry = {
  pid: number,
  workspace?: string,
  jobLabel: string,
  icon?: string,
  iconColor?: string,
};
export type PortEntry = Record<string, any>;

export type CombinedRow = {
  key: string,
  pid?: number,
  name: string,
  isDevServer: boolean,
  isJob?: boolean,
  isSelf?: boolean,
  workspace?: string,
  port?: number,
  proxyPort?: number,
  jobLabel?: string,
  icon?: string,
  iconColor?: string,
  cpu?: number,
  mem?: number,
};

function toDevServerRow(p: PortEntry, cpu?: number, mem?: number): CombinedRow {
  return {
    key: `port-${p.port}`,
    pid: p.pid,
    name: p.process,
    isDevServer: true,
    isSelf: !!p.is_self,
    workspace: p.workspace,
    port: p.port,
    proxyPort: p.proxy_port,
    cpu,
    mem,
  };
}

function toJobRow(job: JobEntry, name: string, cpu?: number, mem?: number): CombinedRow {
  return {
    key: `job-${job.pid}`,
    pid: job.pid,
    name,
    isDevServer: false,
    isJob: true,
    workspace: job.workspace,
    jobLabel: job.jobLabel,
    icon: job.icon,
    iconColor: job.iconColor,
    cpu,
    mem,
  };
}

// dev server/job は先頭固定にせず、processes（ps aux --sort=-%cpu の上位PROCESS_LIST_LIMIT件）の並び順に混ぜる。
// 一致する pid の位置に差し込み、上位に入らない pid は末尾に回す（表示されなくなるのを防ぐ）。
export function buildProcessRows(
  processes: ProcessEntry[],
  ports: PortEntry[],
  jobs: JobEntry[],
): CombinedRow[] {
  const portsByPid = new Map<number, PortEntry[]>();
  for (const p of ports) {
    if (!p.pid) continue;
    const list = portsByPid.get(p.pid) || [];
    list.push(p);
    portsByPid.set(p.pid, list);
  }
  const jobsByPid = new Map(jobs.map((j) => [j.pid, j]));
  const matchedPids = new Set<number>();
  const result: CombinedRow[] = [];
  for (const proc of processes) {
    const matched = portsByPid.get(proc.pid);
    if (matched) {
      matchedPids.add(proc.pid);
      for (const p of matched) result.push(toDevServerRow(p, proc.cpu, proc.mem));
      continue;
    }
    const job = jobsByPid.get(proc.pid);
    if (job) {
      matchedPids.add(proc.pid);
      result.push(toJobRow(job, proc.name, proc.cpu, proc.mem));
    } else {
      result.push({ key: `pid-${proc.pid}`, pid: proc.pid, name: proc.name, isDevServer: false, cpu: proc.cpu, mem: proc.mem });
    }
  }
  for (const p of ports) {
    if (p.pid && matchedPids.has(p.pid)) continue;
    result.push(toDevServerRow(p));
  }
  for (const job of jobs) {
    if (matchedPids.has(job.pid)) continue;
    result.push(toJobRow(job, job.jobLabel));
  }
  return result;
}
