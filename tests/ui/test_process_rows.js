import { describe, it, expect } from "vitest";
import { buildProcessRows } from "../../ui/utils/process-rows.ts";

const proc = (pid, name, cpu = 1, mem = 1) => ({ pid, name, cpu, mem });

describe("buildProcessRows", () => {
  it("processes の並び順を保ったまま dev server / job 行を差し込む", () => {
    const processes = [proc(10, "node", 50), proc(20, "vite", 30), proc(30, "bash", 5)];
    const ports = [{ pid: 20, port: 5173, process: "vite", workspace: "ws1" }];
    const jobs = [{ pid: 30, jobLabel: "Build", workspace: "ws1" }];
    const rows = buildProcessRows(processes, ports, jobs);
    expect(rows.map((r) => r.key)).toEqual(["pid-10", "port-5173", "job-30"]);
    const devRow = rows[1];
    expect(devRow.isDevServer).toBe(true);
    expect(devRow.cpu).toBe(30);
    const jobRow = rows[2];
    expect(jobRow.isJob).toBe(true);
    expect(jobRow.name).toBe("bash");
  });

  it("processes 上位に現れない dev server / job は末尾に回す", () => {
    const processes = [proc(10, "node")];
    const ports = [{ pid: 99, port: 3000, process: "next" }];
    const jobs = [{ pid: 98, jobLabel: "Test" }];
    const rows = buildProcessRows(processes, ports, jobs);
    expect(rows.map((r) => r.key)).toEqual(["pid-10", "port-3000", "job-98"]);
    // 末尾行は cpu/mem 情報なし、job 行の name は jobLabel フォールバック
    expect(rows[1].cpu).toBeUndefined();
    expect(rows[2].name).toBe("Test");
  });

  it("同一 pid が複数ポートで listen していたら全ポート行を展開する", () => {
    const processes = [proc(10, "node")];
    const ports = [
      { pid: 10, port: 3000, process: "node" },
      { pid: 10, port: 3001, process: "node" },
    ];
    const rows = buildProcessRows(processes, ports, []);
    expect(rows.map((r) => r.key)).toEqual(["port-3000", "port-3001"]);
  });

  it("pid の無いポート（検出のみ）は常に末尾へ", () => {
    const rows = buildProcessRows([], [{ port: 8080, process: "unknown" }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("port-8080");
    expect(rows[0].isDevServer).toBe(true);
  });
});
