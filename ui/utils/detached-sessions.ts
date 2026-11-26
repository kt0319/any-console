// 既定値。実効値は ANY_CONSOLE_TMUX_PREFIX で変わるため /system/tmux-info の `prefix` を優先する。
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

export interface DetachedSession {
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
 * プレフィックス付きは any-console 管理（Open 可能。既にタブで開いている knownTabIds は除外）、
 * 無しは外部の個人セッション（external、Close のみ）。
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
