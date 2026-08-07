"""前面プロセスの argv とジョブ定義コマンドの照合。

素のターミナルで手打ちされたコマンドがジョブ定義と一致するかを判定する。
一致したセッションにはジョブメタデータ（TMUX_JOB_NAME 等）が刻印され、
notify_phrase・アイコン表示など既存のジョブ機構がそのまま有効になる
（agent_watch から呼ばれる）。

照合規則（設計判断は ADR 31 参照）:

- ジョブコマンドをコメント行除去 → 改行・`&&`・`;` でステップ分割 →
  空白正規化して、各ステップを照合パターンにする
- `[[var]]` プレースホルダはワイルドカード（1 個以上の任意文字列）にする
- 前面グループのいずれかのプロセスの argv（空白正規化した文字列）と
  ステップの**完全一致のみ**採用する。前方一致は `npm` 始まりのジョブ同士で
  衝突するため使わない
- 誤検知の実害は「セッションにジョブラベルが付く」に閉じる（fail-safe）
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from .job_models import JobDefinition

logger = logging.getLogger(__name__)

_PLACEHOLDER_RE = re.compile(r"\[\[\s*[A-Za-z0-9_]+\s*\]\]")
_COMMENT_LINE_RE = re.compile(r"^\s*#")
_STEP_SPLIT_RE = re.compile(r"&&|;|\n")


@dataclass
class JobPattern:
    name: str
    definition: JobDefinition
    steps: list[re.Pattern[str]]


def _normalize_text(text: str) -> str:
    return " ".join(text.split())


def command_steps(command: str) -> list[str]:
    """ジョブコマンドを照合単位のステップ（正規化済み文字列）に分割する。"""
    lines = [line for line in command.splitlines() if not _COMMENT_LINE_RE.match(line)]
    steps = []
    for part in _STEP_SPLIT_RE.split("\n".join(lines)):
        normalized = _normalize_text(part)
        if normalized:
            steps.append(normalized)
    return steps


def step_to_pattern(step: str) -> re.Pattern[str]:
    """ステップ文字列を照合用の fullmatch 正規表現へ変換する。

    `[[var]]` はワイルドカード、それ以外はリテラル。空白は正規化済み前提。
    """
    parts = []
    last = 0
    for m in _PLACEHOLDER_RE.finditer(step):
        parts.append(re.escape(step[last:m.start()]))
        parts.append(r".+?")
        last = m.end()
    parts.append(re.escape(step[last:]))
    return re.compile("".join(parts))


def build_job_patterns(jobs: dict[str, JobDefinition]) -> list[JobPattern]:
    """ジョブ定義群を照合パターンへ変換する（コマンドの無いジョブは除外）。"""
    patterns = []
    for name, definition in jobs.items():
        steps = command_steps(definition.command or "")
        if not steps:
            continue
        patterns.append(JobPattern(
            name=name,
            definition=definition,
            steps=[step_to_pattern(s) for s in steps],
        ))
    return patterns


def match_job(argvs: list[list[str]], patterns: list[JobPattern]) -> JobPattern | None:
    """前面プロセスの argv 一覧とジョブパターンを照合する（完全一致のみ）。"""
    if not argvs or not patterns:
        return None
    texts = [_normalize_text(" ".join(argv)) for argv in argvs if argv]
    for pattern in patterns:
        for step in pattern.steps:
            if any(step.fullmatch(text) for text in texts):
                return pattern
    return None


def candidate_jobs(workspace: str | None) -> dict[str, JobDefinition]:
    """セッションの照合対象ジョブを返す。

    ワークスペース紐付きならワークスペース + 共通ジョブ、素のターミナルは
    共通ジョブのみ。読み込みは jobs_common の TTL キャッシュに乗る。
    """
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        return {name: entry[0] for name, entry in get_workspace_jobs(workspace).items()}
    data = load_common_jobs_data()
    return {name: entry_to_job_definition(name, raw) for name, raw in data.items()}
