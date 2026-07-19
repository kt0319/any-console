// セッション復元・同期でタブへ反映するメタ情報の純粋ロジック。
//
// サーバの /terminal/sessions はスナップショット + last-known-good（ADR 24）で
// 常に信頼できる一覧を返すため、フロント側のリトライや個別の自己回復は持たない。
// 同期ポーリングが毎回 buildSessionTabParams → buildTabMeta を通してタブ表示を
// サーバ値へ追随させる（一時的な取りこぼしは次のポーリングで自然に直る）。

/**
 * pendingClose のうち、サーバのセッション一覧にもう存在しない id を返す。
 * サーバから消えた時点で削除は完了しており、pendingClose を保持し続ける理由がない。
 * 例外等で clearPendingClose が漏れた場合の取り残しをここで自己回復させる
 * （残ると同期ポーリングがそのセッションのタブを再追加できなくなる）。
 *
 * @param {Iterable<string>} pendingIds pendingClose 中の sessionId
 * @param {Set<string>} serverSessionIds サーバが返した sessionId の集合
 * @returns {string[]}
 */
export function stalePendingCloseIds(pendingIds, serverSessionIds) {
  return [...(pendingIds || [])].filter((id) => !serverSessionIds.has(id));
}

/**
 * /terminal/sessions のセッション meta から addTerminalTab 用のパラメータを組み立てる。
 * 復元・dispatch 結果・ディープリンク・detached 復帰の全経路で共通に使い、アイコン解決の
 * 分岐（wsIcon をワークスペース設定から、ジョブアイコンをジョブ定義から）を一元化する。
 * 呼び出し側は返り値へ `restored` 等を足す。
 *
 * @param {{ ws_url: string, workspace?: string|null, icon?: string|null, icon_color?: string|null, job_name?: string|null, job_label?: string|null }} session
 * @param {{ workspaces?: Array<Record<string, any>>, allJobs?: Record<string, any> }} [ctx]
 */
export function buildSessionTabParams(session, { workspaces = [], allJobs = {} } = {}) {
  const ws = (workspaces || []).find((w) => w.name === session.workspace);
  const jobDef = session.job_name && session.workspace
    ? allJobs?.[session.workspace]?.[session.job_name]
    : null;
  return {
    wsUrl: session.ws_url,
    workspace: session.workspace || null,
    wsIcon: ws?.icon || session.icon || null,
    wsIconColor: ws?.icon_color || session.icon_color || null,
    icon: session.job_name ? (jobDef?.icon || "mdi-play") : "mdi-console",
    iconColor: jobDef?.icon_color || null,
    jobName: session.job_name || null,
    jobLabel: session.job_label || null,
  };
}

/**
 * @typedef {{name: string, color: string|null}|null} TabIcon
 * @typedef {{workspace: string|null, label: string, wsIcon: TabIcon, icon: TabIcon, jobName: string|null, jobLabel: string|null}} TabMeta
 */

/**
 * buildSessionTabParams の出力からタブの表示メタを正規化する。
 * タブ生成（addTerminalTab）と同期時の追随（applyTabMeta）が同じ変換を共有する
 * ことで、「生成時に焼き込んだ値が古いまま残る」クラスの不整合を無くす。
 *
 * @param {{workspace?: string|null, wsIcon?: string|null, wsIconColor?: string|null, icon?: string|null, iconColor?: string|null, jobName?: string|null, jobLabel?: string|null}} params
 * @returns {TabMeta}
 */
export function buildTabMeta({ workspace, wsIcon, wsIconColor, icon, iconColor, jobName, jobLabel }) {
  return {
    workspace: workspace || null,
    label: jobLabel || workspace || "terminal",
    wsIcon: wsIcon ? { name: wsIcon, color: wsIconColor || null } : null,
    icon: icon ? { name: icon, color: iconColor || null } : null,
    jobName: jobName || null,
    jobLabel: jobLabel || null,
  };
}

/** @param {TabIcon} a @param {TabIcon} b */
function iconEquals(a, b) {
  if (!a && !b) return true;
  return !!a && !!b && a.name === b.name && a.color === b.color;
}

/**
 * タブが既に meta と同じ表示状態かを返す。同期ポーリングごとの不要な
 * 再レンダリング（配列参照の張り替え）を避けるための変更検知に使う。
 *
 * @param {{workspace: string|null, label: string, wsIcon: TabIcon, icon: TabIcon, jobName: string|null, jobLabel: string|null}} tab
 * @param {TabMeta} meta
 * @returns {boolean}
 */
export function tabMetaEquals(tab, meta) {
  return tab.workspace === meta.workspace
    && tab.label === meta.label
    && tab.jobName === meta.jobName
    && tab.jobLabel === meta.jobLabel
    && iconEquals(tab.wsIcon, meta.wsIcon)
    && iconEquals(tab.icon, meta.icon);
}
