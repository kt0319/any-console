// tmux セッション一覧を「デタッチセッション（タブ未割り当て）」リストに整形する純粋関数。
// DOM / API から分離してテスト可能にする。

// any-console 管理セッションの tmux 名プレフィックス（既定値）。
// 実効値はサーバが ANY_CONSOLE_TMUX_PREFIX で変えられるため、
// /system/tmux-info の `prefix` を優先して使うこと。
export const AC_PREFIX = "ac-";

export interface TmuxSession {
  name: string;
}

export interface OwnedSession {
  session_id: string;
  workspace?: string | null;
  icon?: string;
  icon_color?: string;
  job_name?: string;
  job_label?: string;
}

interface DetachedSession {
  session_id: string | null;
  tmux_name: string;
  workspace: string | null;
  icon?: string;
  icon_color?: string;
  job_name?: string;
  job_label?: string;
  external: boolean;
}

/**
 * 全 tmux セッションをデタッチセッションリストに整形する。
 * - `ac-` プレフィックス付き = any-console 管理（Open 可能）。owned 情報があれば付与する。
 *   ただし既にタブとして開いている（knownTabIds に含まれる）ものは除外。
 * - プレフィックスなし = 外部のユーザ個人セッション（external 扱い、Close のみ）。
 *
 * @param allSessions 全 tmux セッション
 * @param owned any-console 管理セッション（/terminal/sessions）
 * @param knownTabIds 既に開いているタブの session_id 集合
 * @param prefix サーバの実効 tmux プレフィックス（/system/tmux-info の `prefix`）
 */
export function buildDetachedSessionList(
  allSessions: TmuxSession[],
  owned: OwnedSession[],
  knownTabIds: Set<string> | Iterable<string>,
  prefix: string = AC_PREFIX,
): DetachedSession[] {
  const ownedById = new Map((owned || []).map((s) => [s.session_id, s]));
  const known = knownTabIds instanceof Set ? knownTabIds : new Set(knownTabIds || []);
  const list: DetachedSession[] = [];
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
