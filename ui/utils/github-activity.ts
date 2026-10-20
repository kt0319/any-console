// サーバ（github_watch）が確定した PR / Issue の新着コメント・レビューと CI 完了を、
// peek 表示の文言にする純粋ロジック（usePillPeek が使う）。

export type ActivityEvent = {
  kind: "comment" | "review" | "run",
  target: "pr" | "issue" | "ci",
  number: number,
  title: string,
  author: string | null,
  createdAt: string,
  url: string,
  overflow?: boolean,
  workflow?: string,
  conclusion?: string | null,
  branch?: string,
};

type ActivityGroup = { title: string, number: number, comments: number, reviews: number, commentsOverflow: boolean, reviewsOverflow: boolean };

function countLabel(count: number, overflow: boolean, noun: string): string {
  return `${count}${overflow ? "+" : ""} new ${noun}${count > 1 || overflow ? "s" : ""}`;
}

function describeGroupCounts(comments: number, commentsOverflow: boolean, reviews: number, reviewsOverflow: boolean): string {
  const parts: string[] = [];
  if (comments > 0) parts.push(countLabel(comments, commentsOverflow, "comment"));
  if (reviews > 0) parts.push(countLabel(reviews, reviewsOverflow, "review"));
  return parts.join(", ");
}

/**
 * サーバが確定した新着コメント/レビューの peek 文言を1つ返す（対象が無ければ null）。
 * 複数の PR/Issue にまたがる場合は「N issues: 5 new comments」のように1つへまとめる
 * （1件ずつ積むとピルを N×表示時間 占有するため）。
 */
export function describeActivityEvents(events: ActivityEvent[], noun: string): string | null {
  const groups = new Map<number, ActivityGroup>();
  for (const ev of events) {
    if (ev.kind === "run") continue;
    const group = groups.get(ev.number)
      ?? { title: ev.title, number: ev.number, comments: 0, reviews: 0, commentsOverflow: false, reviewsOverflow: false };
    if (ev.kind === "review") {
      group.reviews += 1;
      group.reviewsOverflow ||= !!ev.overflow;
    } else {
      group.comments += 1;
      group.commentsOverflow ||= !!ev.overflow;
    }
    groups.set(ev.number, group);
  }
  const list = [...groups.values()];
  if (!list.length) return null;
  if (list.length === 1) {
    const [g] = list;
    return `#${g.number} ${describeGroupCounts(g.comments, g.commentsOverflow, g.reviews, g.reviewsOverflow)}: ${g.title}`;
  }
  const sum = (pick: (g: ActivityGroup) => number) => list.reduce((total, g) => total + pick(g), 0);
  const counts = describeGroupCounts(
    sum((g) => g.comments), list.some((g) => g.commentsOverflow),
    sum((g) => g.reviews), list.some((g) => g.reviewsOverflow),
  );
  return `${list.length} ${noun}s: ${counts}`;
}

/** 完了した CI run の peek 文言（Actions ピルの通常表示 `[name] conclusion` と揃える）。 */
export function describeRunEvent(ev: ActivityEvent): string {
  return `[${ev.title || ev.workflow || ""}] ${ev.conclusion || "completed"}`;
}
