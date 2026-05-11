// @ts-check
import { describe, it, expect } from "vitest";
import { GRAPH_ROW_HEIGHT, GRAPH_COL_WIDTH, colColor, parseGitGraphOutput, buildGitGraphRows, computeGraphWidth } from "../../ui/utils/git-graph.js";

const HALF = GRAPH_ROW_HEIGHT / 2;

// ── Tests ──

describe("colColor", () => {
  it("returns first color for col 0", () => {
    expect(colColor(0)).toBe("#7aa2f7");
  });
  it("wraps around at COLORS length", () => {
    expect(colColor(8)).toBe(colColor(0));
    expect(colColor(9)).toBe(colColor(1));
  });
});

describe("parseGitGraphOutput", () => {
  it("returns empty for empty input", () => {
    expect(parseGitGraphOutput("")).toEqual([]);
    expect(parseGitGraphOutput(null)).toEqual([]);
  });

  it("parses a single commit line", () => {
    const hash = "a".repeat(40);
    const line = `* ${hash}\t2025-01-01 12:00\tAuthor\tHEAD -> main\tcommit message`;
    const result = parseGitGraphOutput(line);
    expect(result.length).toBe(1);
    expect(result[0].graph).toBe("*");
    expect(result[0].entry.fullHash).toBe(hash);
    expect(result[0].entry.hash).toBe(hash.slice(0, 8));
    expect(result[0].entry.author).toBe("Author");
    expect(result[0].entry.message).toBe("commit message");
  });

  it("parses graph-only lines", () => {
    const result = parseGitGraphOutput("| |");
    expect(result.length).toBe(1);
    expect(result[0].entry).toBe(null);
    expect(result[0].graph).toBe("| |");
  });

  it("parses multiple lines with merge", () => {
    const h1 = "a".repeat(40);
    const h2 = "b".repeat(40);
    const input = [
      `* ${h1}\t2025-01-02 10:00\tAlice\t\tfirst`,
      `|\\`,
      `| * ${h2}\t2025-01-01 09:00\tBob\t\tsecond`,
    ].join("\n");
    const result = parseGitGraphOutput(input);
    expect(result.length).toBe(3);
    expect(result[0].entry.message).toBe("first");
    expect(result[1].entry).toBe(null);
    expect(result[2].entry.message).toBe("second");
  });
});

describe("buildGitGraphRows", () => {
  it("creates node segment for *", () => {
    const parsed = [{ graph: "*", entry: { hash: "abc" } }];
    const rows = buildGitGraphRows(parsed);
    expect(rows.length).toBe(1);
    const nodeSegs = rows[0].segments.filter((s) => s.type === "node");
    expect(nodeSegs.length).toBe(1);
    expect(nodeSegs[0].x).toBe(GRAPH_COL_WIDTH / 2);
    expect(nodeSegs[0].y).toBe(HALF);
  });

  it("creates line segment for |", () => {
    const parsed = [{ graph: "|", entry: null }];
    const rows = buildGitGraphRows(parsed);
    const lineSegs = rows[0].segments.filter((s) => s.type === "line");
    expect(lineSegs.length).toBe(1);
    expect(lineSegs[0].y1).toBe(0);
    expect(lineSegs[0].y2).toBe(GRAPH_ROW_HEIGHT);
  });

  it("creates diagonal for / and \\", () => {
    const parsed = [{ graph: " /", entry: null }, { graph: " \\", entry: null }];
    const rows = buildGitGraphRows(parsed);
    expect(rows[0].segments.length).toBe(1);
    expect(rows[0].segments[0].type).toBe("line");
    expect(rows[1].segments.length).toBe(1);
    expect(rows[1].segments[0].type).toBe("line");
  });

  it("handles multi-column graph", () => {
    const parsed = [{ graph: "* |", entry: { hash: "abc" } }];
    const rows = buildGitGraphRows(parsed);
    const nodeSegs = rows[0].segments.filter((s) => s.type === "node");
    const lineSegs = rows[0].segments.filter((s) => s.type === "line");
    expect(nodeSegs.length).toBe(1);
    expect(lineSegs.length >= 3).toBeTruthy();
  });
});

describe("computeGraphWidth", () => {
  it("returns single column width for empty rows", () => {
    expect(computeGraphWidth([])).toBe(GRAPH_COL_WIDTH);
  });

  it("computes width from node positions", () => {
    const rows = buildGitGraphRows([{ graph: "* |", entry: null }]);
    const width = computeGraphWidth(rows);
    expect(width >= 2 * GRAPH_COL_WIDTH).toBeTruthy();
  });
});
