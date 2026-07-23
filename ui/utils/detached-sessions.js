// tmux セッション一覧を「デタッチセッション（タブ未割り当て）」リストに整形する純粋関数。
// DOM / API から分離してテスト可能にする。

// any-console 管理セッションの tmux 名プレフィックス（既定値）。
// 実効値はサーバが ANY_CONSOLE_TMUX_PREFIX で変えられるため、
// /system/tmux-info の `prefix` を優先して使うこと。
export const AC_PREFIX = "ac-";

/**
 * @typedef {Object} TmuxSession
 * @property {string} name
 */

/**
 * @typedef {Object} OwnedSession
 * @property {string} session_id
 * @property {string|null} [workspace]
 * @property {string} [icon]
 * @property {string} [icon_color]
 * @property {string} [job_name]
 * @property {string} [job_label]
 */

/**
 * 全 tmux セッションをデタッチセッションリストに整形する。
 * - `ac-` プレフィックス付き = any-console 管理（Open 可能）。owned 情報があれば付与する。
 *   ただし既にタブとして開いている（knownTabIds に含まれる）ものは除外。
 * - プレフィックスなし = 外部のユーザ個人セッション（external 扱い、Close のみ）。
 *
 * @param {TmuxSession[]} allSessions 全 tmux セッション
 * @param {OwnedSession[]} owned any-console 管理セッション（/terminal/sessions）
 * @param {Set<string>|Iterable<string>} knownTabIds 既に開いているタブの session_id 集合
 * @param {string} [prefix] サーバの実効 tmux プレフィックス（/system/tmux-info の `prefix`）
 * @returns {Object[]}
 */
export function buildDetachedSessionList(allSessions, owned, knownTabIds, prefix = AC_PREFIX) {
  const ownedById = new Map((owned || []).map((s) => [s.session_id, s]));
  const known = knownTabIds instanceof Set ? knownTabIds : new Set(knownTabIds || []);
  const list = [];
  for (const s of allSessions || []) {
    if (s.name.startsWith(prefix)) {
      const sessionId = s.name.slice(prefix.length);
      if (known.has(sessionId)) continue;
      const ownedEntry = ownedById.get(sessionId);
      list.push({
        session_id: sessionId,
        tmux_name: s.name,
        workspace: ownedEntry?.workspace || null,
        icon: ownedEntry?.icon,
        icon_color: ownedEntry?.icon_color,
        job_name: ownedEntry?.job_name,
        job_label: ownedEntry?.job_label,
        external: false,
      });
    } else {
      list.push({
        session_id: null,
        tmux_name: s.name,
        workspace: null,
        external: true,
      });
    }
  }
  return list;
}
