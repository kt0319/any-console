// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of dependencies ──

function formatGitTime(timeText) {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return timeText;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function parseGitRefs(refsStr) {
  if (!refsStr) return [];
  return refsStr.split(", ")
    .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
    .map((r) => {
      if (r.startsWith("HEAD -> ")) return { label: r.replace("HEAD -> ", ""), type: "head", icon: "mdi-source-branch" };
      if (r.startsWith("tag: ")) return { label: r.replace("tag: ", ""), type: "tag", icon: "mdi-tag-outline" };
      if (r.startsWith("origin/")) return { label: r, type: "remote", icon: "mdi-github" };
      return { label: r, type: "branch", icon: "mdi-source-branch" };
    });
}

// ── Inline copies from git-graph.js ──

const GRAPH_ROW_HEIGHT = 28;
const GRAPH_COL_WIDTH = 8;
const HALF = GRAPH_ROW_HEIGHT / 2;
const COLORS = ["#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#c0caf5"];

function colColor(col) {
  return COLORS[col % COLORS.length];
}

function parseGitGraphOutput(stdout) {
  if (!stdout) return [];
  const lines = stdout.split("\n");
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^([*|/\\ _\-.]+?)\s*([0-9a-f]{40}\t.+)$/);
    if (match) {
      const graphPart = match[1];
      const dataPart = match[2];
      const fields = dataPart.split("\t");
      if (fields.length >= 5) {
        const [hash, time, author, refs, ...msgParts] = fields;
        parsed.push({
          graph: graphPart,
          entry: {
            hash: hash.slice(0, 8),
            fullHash: hash,
            author,
            time: formatGitTime(time),
            message: msgParts.join("\t"),
            refs: parseGitRefs(refs),
          },
        });
      } else {
        parsed.push({ graph: graphPart, entry: null });
      }
    } else {
      parsed.push({ graph: line.replace(/\t.*$/, ""), entry: null });
    }
  }
  return parsed;
}

function buildGitGraphRows(parsed) {
  const result = [];
  for (const item of parsed) {
    const graph = item.graph;
    const segments = [];
    for (let i = 0; i < graph.length; i++) {
      const ch = graph[i];
      if (ch === "*" || ch === "|") {
        const col = Math.floor(i / 2);
        const x = col * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2;
        if (ch === "*") {
          segments.push({ type: "node", x, y: HALF, color: colColor(col) });
          segments.push({ type: "line", x, y1: 0, y2: HALF, color: colColor(col) });
          segments.push({ type: "line", x, y1: HALF, y2: GRAPH_ROW_HEIGHT, color: colColor(col) });
        } else {
          segments.push({ type: "line", x, y1: 0, y2: GRAPH_ROW_HEIGHT, color: colColor(col) });
        }
      } else if (ch === "/") {
        const fromCol = Math.ceil(i / 2);
        const toCol = Math.floor(i / 2);
        segments.push({ type: "line", x: fromCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2, y1: 0, x2: toCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2, y2: GRAPH_ROW_HEIGHT, color: colColor(fromCol) });
      } else if (ch === "\\") {
        const fromCol = Math.floor(i / 2);
        const toCol = Math.ceil(i / 2);
        segments.push({ type: "line", x: fromCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2, y1: 0, x2: toCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2, y2: GRAPH_ROW_HEIGHT, color: colColor(toCol) });
      }
    }
    result.push({ segments, entry: item.entry });
  }
  return result;
}

function computeGraphWidth(graphRows) {
  let maxCol = 0;
  for (const row of graphRows) {
    for (const seg of row.segments) {
      const col = seg.type === "node"
        ? Math.round(seg.x / GRAPH_COL_WIDTH)
        : Math.max(Math.round(seg.x / GRAPH_COL_WIDTH), Math.round((seg.x2 ?? seg.x) / GRAPH_COL_WIDTH));
      if (col > maxCol) maxCol = col;
    }
  }
  return (maxCol + 1) * GRAPH_COL_WIDTH;
}

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
