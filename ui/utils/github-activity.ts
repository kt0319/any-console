// PR / Issue へのコメント・レビューの増加を、ポーリング結果の前回値との差分から検出する
// 純粋ロジック（usePillPeek が peek 表示の文言に使う）。

export type ActivityCounts = { comments: number, reviews: number };
export type ActivitySnapshot = Map<number, ActivityCounts>;
export type ActivityItem = {
  number: number,
  title: string,
  commentCount?: number,
  reviewCount?: number,
  lastCommentByMe?: boolean,
  lastReviewByMe?: boolean,
};

export function snapshotActivity(items: ActivityItem[]): ActivitySnapshot {
  return new Map(items.map((it) => [it.number, { comments: it.commentCount || 0, reviews: it.reviewCount || 0 }]));
}

function countText(delta: number, noun: string): string {
  return `${delta} new ${noun}${delta > 1 ? "s" : ""}`;
}

// 最後の投稿が自分のものなら、その1件は自分起因として増分から除く
// （自分の投稿が複数まとまって増えた場合は他者分と区別できないため、除くのは1件のみ）。
function externalDelta(now: number | undefined, before: number, lastByMe: boolean | undefined): number {
  const delta = (now || 0) - before;
  return lastByMe ? delta - 1 : delta;
}

function describeCounts(comments: number, reviews: number): string {
  const parts: string[] = [];
  if (comments > 0) parts.push(countText(comments, "comment"));
  if (reviews > 0) parts.push(countText(reviews, "review"));
  return parts.join(", ");
}

/**
 * 前回のスナップショットにあった項目のうち、他者のコメント/レビューが増えたものの
 * peek 文言を1つ返す（増えた項目が無ければ null）。
 * 前回に無かった項目（新規PR・新規Issue）や件数が減った項目は対象外。
 * 複数項目で増えた場合は「N issues: 5 new comments」のように1つへまとめる
 * （1件ずつ積むとピルを N×表示時間 占有するため）。
 */
export function describeNewActivity(prev: ActivitySnapshot, items: ActivityItem[], noun: string): string | null {
  const changed: { item: ActivityItem, comments: number, reviews: number }[] = [];
  for (const item of items) {
    const before = prev.get(item.number);
    if (!before) continue;
    const comments = Math.max(0, externalDelta(item.commentCount, before.comments, item.lastCommentByMe));
    const reviews = Math.max(0, externalDelta(item.reviewCount, before.reviews, item.lastReviewByMe));
    if (comments || reviews) changed.push({ item, comments, reviews });
  }
  if (!changed.length) return null;
  if (changed.length === 1) {
    const [{ item, comments, reviews }] = changed;
    return `#${item.number} ${describeCounts(comments, reviews)}: ${item.title}`;
  }
  const comments = changed.reduce((sum, c) => sum + c.comments, 0);
  const reviews = changed.reduce((sum, c) => sum + c.reviews, 0);
  return `${changed.length} ${noun}s: ${describeCounts(comments, reviews)}`;
}

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
