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

/**
 * 前回のスナップショットにあった項目のうち、他者のコメント/レビューが増えたものの peek 文言を返す。
 * 前回に無かった項目（新規PR・新規Issue）や件数が減った項目は対象外。
 */
export function describeNewActivity(prev: ActivitySnapshot, items: ActivityItem[]): string[] {
  const texts: string[] = [];
  for (const it of items) {
    const before = prev.get(it.number);
    if (!before) continue;
    const parts: string[] = [];
    const comments = externalDelta(it.commentCount, before.comments, it.lastCommentByMe);
    const reviews = externalDelta(it.reviewCount, before.reviews, it.lastReviewByMe);
    if (comments > 0) parts.push(countText(comments, "comment"));
    if (reviews > 0) parts.push(countText(reviews, "review"));
    if (parts.length) texts.push(`#${it.number} ${parts.join(", ")}: ${it.title}`);
  }
  return texts;
}
