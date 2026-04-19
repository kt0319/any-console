// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GRAPH_ROW_HEIGHT, GRAPH_COL_WIDTH, colColor, parseGitGraphOutput, buildGitGraphRows, computeGraphWidth } from "../../ui/utils/git-graph.js";

const HALF = GRAPH_ROW_HEIGHT / 2;

// ── Tests ──

describe("colColor", () => {
  it("returns first color for col 0", () => {
    assert.equal(colColor(0), "#7aa2f7");
  });
  it("wraps around at COLORS length", () => {
    assert.equal(colColor(8), colColor(0));
    assert.equal(colColor(9), colColor(1));
  });
});

describe("parseGitGraphOutput", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(parseGitGraphOutput(""), []);
    assert.deepEqual(parseGitGraphOutput(null), []);
  });

  it("parses a single commit line", () => {
    const hash = "a".repeat(40);
    const line = `* ${hash}\t2025-01-01 12:00\tAuthor\tHEAD -> main\tcommit message`;
    const result = parseGitGraphOutput(line);
    assert.equal(result.length, 1);
    assert.equal(result[0].graph, "*");
    assert.equal(result[0].entry.fullHash, hash);
    assert.equal(result[0].entry.hash, hash.slice(0, 8));
    assert.equal(result[0].entry.author, "Author");
    assert.equal(result[0].entry.message, "commit message");
  });

  it("parses graph-only lines", () => {
    const result = parseGitGraphOutput("| |");
    assert.equal(result.length, 1);
    assert.equal(result[0].entry, null);
    assert.equal(result[0].graph, "| |");
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
    assert.equal(result.length, 3);
    assert.equal(result[0].entry.message, "first");
    assert.equal(result[1].entry, null);
    assert.equal(result[2].entry.message, "second");
  });
});

describe("buildGitGraphRows", () => {
  it("creates node segment for *", () => {
    const parsed = [{ graph: "*", entry: { hash: "abc" } }];
    const rows = buildGitGraphRows(parsed);
    assert.equal(rows.length, 1);
    const nodeSegs = rows[0].segments.filter((s) => s.type === "node");
    assert.equal(nodeSegs.length, 1);
    assert.equal(nodeSegs[0].x, GRAPH_COL_WIDTH / 2);
    assert.equal(nodeSegs[0].y, HALF);
  });

  it("creates line segment for |", () => {
    const parsed = [{ graph: "|", entry: null }];
    const rows = buildGitGraphRows(parsed);
    const lineSegs = rows[0].segments.filter((s) => s.type === "line");
    assert.equal(lineSegs.length, 1);
    assert.equal(lineSegs[0].y1, 0);
    assert.equal(lineSegs[0].y2, GRAPH_ROW_HEIGHT);
  });

  it("creates diagonal for / and \\", () => {
    const parsed = [{ graph: " /", entry: null }, { graph: " \\", entry: null }];
    const rows = buildGitGraphRows(parsed);
    assert.equal(rows[0].segments.length, 1);
    assert.equal(rows[0].segments[0].type, "line");
    assert.equal(rows[1].segments.length, 1);
    assert.equal(rows[1].segments[0].type, "line");
  });

  it("handles multi-column graph", () => {
    const parsed = [{ graph: "* |", entry: { hash: "abc" } }];
    const rows = buildGitGraphRows(parsed);
    const nodeSegs = rows[0].segments.filter((s) => s.type === "node");
    const lineSegs = rows[0].segments.filter((s) => s.type === "line");
    assert.equal(nodeSegs.length, 1);
    assert.ok(lineSegs.length >= 3);
  });
});

describe("computeGraphWidth", () => {
  it("returns single column width for empty rows", () => {
    assert.equal(computeGraphWidth([]), GRAPH_COL_WIDTH);
  });

  it("computes width from node positions", () => {
    const rows = buildGitGraphRows([{ graph: "* |", entry: null }]);
    const width = computeGraphWidth(rows);
    assert.ok(width >= 2 * GRAPH_COL_WIDTH);
  });
});
