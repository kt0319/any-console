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
