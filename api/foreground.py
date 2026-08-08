"""ペインの前面ジョブ（フォアグラウンドプロセスグループ）の argv 取得。

screen manifest のエージェント特定（ラッパー起動対応）とジョブ照合が共有する
レイヤ。tmux の `#{pane_pid}`（ペインのシェル PID）を起点に、そのシェルの
制御端末で前面にいるプロセスグループの各プロセスの argv を返す。

- Linux: `/proc/<pid>/stat` の tpgid でグループを特定し、シェルの子孫
  （`/proc/<pid>/task/<tid>/children`）のうちグループに属するものの
  `/proc/<pid>/cmdline` を読む
- macOS: `ps -axo pid=,pgid=,tpgid=,command=` を周期あたり 1 回だけ実行して
  表から引く（`api/preview.py` の cwd 取得と同じ二系統分岐）

ベストエフォート: 取得できない場合はすべて空リストを返す（呼び出し側は
「前面ジョブ無し」として扱う）。agent_watch のポーリングから毎周期呼ばれる
ため、ForegroundInspector は 1 周期分の問い合わせをまとめて macOS の ps
実行を 1 回に抑える。
"""

from __future__ import annotations

import logging
import os

from .common import SYSTEM_CMD_TIMEOUT_SEC, run_subprocess_safe

logger = logging.getLogger(__name__)

# 子孫走査の安全上限（異常なプロセスツリーでの暴走防止）
_MAX_DESCENDANTS = 64


def parse_stat_pgrp_tpgid(stat_text: str) -> tuple[int, int] | None:
    """`/proc/<pid>/stat` から (pgrp, tpgid) を取り出す。

    comm フィールドは空白・括弧を含みうるため、最後の ')' より後を分割する。
    フィールドは ')' の後ろから state, ppid, pgrp, session, tty_nr, tpgid の順。
    """
    end = stat_text.rfind(")")
    if end < 0:
        return None
    fields = stat_text[end + 1:].split()
    if len(fields) < 6:
        return None
    try:
        return int(fields[2]), int(fields[5])
    except ValueError:
        return None


def parse_ps_lines(text: str) -> list[tuple[int, int, int, list[str]]]:
    """`ps -axo pid=,pgid=,tpgid=,command=` の出力を (pid, pgid, tpgid, argv) に変換する。

    command は空白区切りの近似（ps はクォート情報を保持しない）。
    """
    rows = []
    for line in text.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        try:
            pid, pgid, tpgid = int(parts[0]), int(parts[1]), int(parts[2])
        except ValueError:
            continue
        rows.append((pid, pgid, tpgid, parts[3].split()))
    return rows


def _read_proc_stat(pid: int) -> tuple[int, int] | None:
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8", errors="replace") as f:
            return parse_stat_pgrp_tpgid(f.read())
    except OSError:
        return None


def _read_proc_argv(pid: int) -> list[str]:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            raw = f.read()
    except OSError:
        return []
    return [part.decode("utf-8", errors="replace") for part in raw.split(b"\x00") if part]


def _iter_descendants(root_pid: int) -> list[int]:
    """/proc の children インターフェースで子孫 PID を幅優先で列挙する。"""
    result: list[int] = []
    queue = [root_pid]
    while queue and len(result) < _MAX_DESCENDANTS:
        pid = queue.pop(0)
        try:
            with open(f"/proc/{pid}/task/{pid}/children", encoding="ascii") as f:
                children = [int(c) for c in f.read().split()]
        except (OSError, ValueError):
            continue
        for child in children:
            result.append(child)
            queue.append(child)
    return result


def _linux_foreground_argvs(shell_pid: int) -> list[list[str]]:
    stat = _read_proc_stat(shell_pid)
    if stat is None:
        return []
    shell_pgrp, tpgid = stat
    if tpgid <= 0 or tpgid == shell_pgrp:
        # 前面がシェル自身 = ジョブは走っていない
        return []
    argvs = []
    seen = set()
    # グループリーダー（pid == tpgid）は children 走査に依存せず直接読む
    leader_argv = _read_proc_argv(tpgid)
    if leader_argv:
        argvs.append(leader_argv)
        seen.add(tpgid)
    for pid in _iter_descendants(shell_pid):
        if pid in seen:
            continue
        pid_stat = _read_proc_stat(pid)
        if pid_stat is None or pid_stat[0] != tpgid:
            continue
        argv = _read_proc_argv(pid)
        if argv:
            argvs.append(argv)
            seen.add(pid)
    return argvs


class ForegroundInspector:
    """1 ポーリング周期分の前面ジョブ問い合わせ。

    macOS では初回の問い合わせで ps の全プロセス表を 1 回だけ取得して使い回す。
    Linux では /proc を都度読む（十分軽い）。周期をまたいで使い回さないこと
    （プロセス状態が古くなるため、毎周期作り直す）。
    """

    def __init__(self) -> None:
        self._ps_rows: list[tuple[int, int, int, list[str]]] | None = None

    def _darwin_rows(self) -> list[tuple[int, int, int, list[str]]]:
        if self._ps_rows is None:
            result = run_subprocess_safe(
                ["ps", "-axo", "pid=,pgid=,tpgid=,command="],
                timeout=SYSTEM_CMD_TIMEOUT_SEC, log_label="ps",
            )
            if result is None or result.returncode != 0:
                self._ps_rows = []
            else:
                self._ps_rows = parse_ps_lines(str(result.stdout))
        return self._ps_rows

    def argvs(self, shell_pid: int) -> list[list[str]]:
        """シェル PID の前面プロセスグループの argv 一覧を返す（失敗時は空）。"""
        if shell_pid <= 0:
            return []
        if os.path.isdir(f"/proc/{shell_pid}"):
            try:
                return _linux_foreground_argvs(shell_pid)
            except OSError:
                return []
        rows = self._darwin_rows()
        tpgid = next((r[2] for r in rows if r[0] == shell_pid), 0)
        if tpgid <= 0:
            return []
        shell_pgid = next((r[1] for r in rows if r[0] == shell_pid), 0)
        if tpgid == shell_pgid:
            return []
        return [argv for _, pgid, _, argv in rows if pgid == tpgid and argv]


__all__ = [
    "ForegroundInspector",
    "parse_ps_lines",
    "parse_stat_pgrp_tpgid",
]
