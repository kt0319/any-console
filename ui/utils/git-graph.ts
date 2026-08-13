import { formatGitTime, parseGitRefs } from "./git.ts";

export const GRAPH_ROW_HEIGHT = 28;
export const GRAPH_COL_WIDTH = 8;
const HALF = GRAPH_ROW_HEIGHT / 2;
const COLORS = ["#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#c0caf5"];

// git.ts の parseGitRefs が返す ref バッジ1件分。
type GitRef = { label: string, type: string, icon: string, synced?: boolean };

type GitGraphEntry = {
  hash: string,
  fullHash: string,
  author: string,
  time: string,
  message: string,
  refs: GitRef[],
  // 呼び出し側（useGitLogPagination）が後付けするフラグ。
  pending?: boolean,
  unpushed?: boolean,
};

type ParsedGraphLine = { graph: string, entry: GitGraphEntry | null };

type GraphSegment =
  | { type: "node", x: number, y: number, color: string }
  | { type: "line", x: number, y1: number, x2?: number, y2: number, color: string };

type GitGraphRow = { segments: GraphSegment[], entry: GitGraphEntry | null };

export function colColor(col: number): string {
  return COLORS[col % COLORS.length];
}

export function parseGitGraphOutput(stdout: string | null | undefined): ParsedGraphLine[] {
  if (!stdout) return [];
  const lines = stdout.split("\n");
  const parsed: ParsedGraphLine[] = [];

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

export function buildGitGraphRows(parsed: ParsedGraphLine[]): GitGraphRow[] {
  const result: GitGraphRow[] = [];

  for (const item of parsed) {
    const graph = item.graph;
    const segments: GraphSegment[] = [];

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
        const fromX = fromCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2;
        const toX = toCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2;
        segments.push({ type: "line", x: fromX, y1: 0, x2: toX, y2: GRAPH_ROW_HEIGHT, color: colColor(fromCol) });
      } else if (ch === "\\") {
        const fromCol = Math.floor(i / 2);
        const toCol = Math.ceil(i / 2);
        const fromX = fromCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2;
        const toX = toCol * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2;
        segments.push({ type: "line", x: fromX, y1: 0, x2: toX, y2: GRAPH_ROW_HEIGHT, color: colColor(toCol) });
      }
    }

    result.push({ segments, entry: item.entry });
  }

  return result;
}

export function computeGraphWidth(graphRows: GitGraphRow[]): number {
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
