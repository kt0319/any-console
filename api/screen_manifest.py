"""herdr の screen manifest によるエージェント状態判定。

ベンダリングした TOML マニフェスト（`api/agent_manifests/` — ogulcancelik/herdr
由来、Apache-2.0）を可視ペイン内容と照合し、既知エージェント（Claude Code /
Codex）の blocked（承認・入力待ち）等の状態を判定する。評価の意味論は herdr の
`src/detect/manifest.rs` に合わせる:

- ルールは定義順に走査し、優先度が「厳密に大きい」ときだけ勝者を置き換える
  （同優先度は先勝ち）。
- `contains` は小文字化した部分一致の AND。`regex` はリージョン全体への検索、
  `line_regex` は「各パターンがいずれかの行に一致」。`any` は OR、`all` は AND、
  `not` は「どれにも一致しない」。
- 勝者ルールが `skip_state_update` の場合は状態を確定しない（None を返す）。

`osc_progress` リージョンは tmux 経由では取得できないため常に空文字になり、
該当ルールは一致しない（graceful degradation）。`osc_title` は `#{pane_title}`
を渡す。マニフェストは読み取り専用の同梱データであり、`data/` 配下の状態
ファイルではない（`DATA_DIR` 隔離の対象外）。
"""

from __future__ import annotations

import logging
import re
import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

MANIFEST_DIR = Path(__file__).parent / "agent_manifests"

STATE_BLOCKED = "blocked"
STATE_UNKNOWN = "unknown"

_RUST_UNICODE_ESCAPE_RE = re.compile(r"\\x\{([0-9A-Fa-f]{1,6})\}")


def translate_rust_regex(pattern: str) -> str:
    """Rust regex の `\\x{HHHH}` Unicode エスケープを Python `re` の形式へ変換する。"""

    def repl(m: re.Match[str]) -> str:
        cp = int(m.group(1), 16)
        if cp <= 0xFFFF:
            return f"\\u{cp:04x}"
        return f"\\U{cp:08x}"

    return _RUST_UNICODE_ESCAPE_RE.sub(repl, pattern)


@dataclass
class Gate:
    contains: list[str]
    regex: list[re.Pattern[str]]
    line_regex: list[re.Pattern[str]]
    all_gates: list["Gate"]
    any_gates: list["Gate"]
    not_gates: list["Gate"]


@dataclass
class Rule:
    id: str
    state: str
    priority: int
    region: str
    skip_state_update: bool
    gate: Gate


@dataclass
class Manifest:
    id: str
    aliases: list[str]
    rules: list[Rule]


def _compile_gate(raw: dict) -> Gate:
    return Gate(
        contains=[str(s).lower() for s in raw.get("contains", [])],
        regex=[re.compile(translate_rust_regex(str(p))) for p in raw.get("regex", [])],
        line_regex=[re.compile(translate_rust_regex(str(p))) for p in raw.get("line_regex", [])],
        all_gates=[_compile_gate(g) for g in raw.get("all", [])],
        any_gates=[_compile_gate(g) for g in raw.get("any", [])],
        not_gates=[_compile_gate(g) for g in raw.get("not", [])],
    )


def _compile_manifest(raw: dict) -> Manifest:
    rules = []
    for raw_rule in raw.get("rules", []):
        rules.append(Rule(
            id=str(raw_rule.get("id", "")),
            state=str(raw_rule.get("state", STATE_UNKNOWN)),
            priority=int(raw_rule.get("priority", 0)),
            region=str(raw_rule.get("region", "whole_recent")).strip(),
            skip_state_update=bool(raw_rule.get("skip_state_update", False)),
            gate=_compile_gate(raw_rule),
        ))
    return Manifest(
        id=str(raw.get("id", "")),
        aliases=[str(a).lower() for a in raw.get("aliases", [])],
        rules=rules,
    )


@lru_cache(maxsize=1)
def load_manifests() -> tuple[Manifest, ...]:
    """同梱マニフェストを読み込んでコンパイルする（プロセス内キャッシュ）。

    1 ファイルでも壊れていたらそのファイルだけ捨てる（fail-safe: 検知しない側へ倒す）。
    ルール単位のスキップはしない — ガード用ルール（skip_state_update / unknown）が
    欠けると誤検知側へ倒れるため、ファイル単位で全捨てする。
    """
    manifests = []
    for path in sorted(MANIFEST_DIR.glob("*.toml")):
        try:
            raw = tomllib.loads(path.read_text(encoding="utf-8"))
            manifest = _compile_manifest(raw)
        except (OSError, tomllib.TOMLDecodeError, re.error, ValueError, TypeError) as e:
            logger.warning("screen manifest load failed file=%s: %s", path.name, e)
            continue
        if manifest.id:
            manifests.append(manifest)
    return tuple(manifests)


def identify_agent(pane_command: str | None) -> Manifest | None:
    """tmux の `#{pane_current_command}` からエージェントのマニフェストを特定する。"""
    if not pane_command:
        return None
    name = pane_command.strip().lower().rsplit("/", 1)[-1]
    if not name:
        return None
    for manifest in load_manifests():
        if name == manifest.id or name in manifest.aliases:
            return manifest
    return None


# ─── リージョン切り出し（herdr manifest.rs の移植） ─────────────────────────

def _lines(text: str) -> list[str]:
    """Rust の `str::lines()` 相当（末尾改行後の空要素を作らず、\\r を除去）。"""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return [line[:-1] if line.endswith("\r") else line for line in lines]


def is_horizontal_rule(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed:
        return False
    rule_chars = 0
    for ch in trimmed:
        if ch == "─":
            rule_chars += 1
        else:
            break
    if rule_chars == 0:
        return False
    suffix = trimmed[rule_chars:].lstrip()
    return not suffix or rule_chars >= 3


def _bottom_non_empty_lines(lines: list[str], count: int) -> str:
    start = None
    remaining = count
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip():
            start = i
            remaining -= 1
            if remaining == 0:
                break
    if start is None:
        return ""
    return "\n".join(lines[start:])


def _after_last_horizontal_rule(lines: list[str]) -> str:
    last = -1
    for i, line in enumerate(lines):
        if is_horizontal_rule(line):
            last = i
    return "\n".join(lines[last + 1:])


def _prompt_box_top_border_index(lines: list[str]) -> int | None:
    border_count = 0
    for i in range(len(lines) - 1, -1, -1):
        if is_horizontal_rule(lines[i]):
            border_count += 1
            if border_count == 2:
                return i
    return None


def _prompt_box_body(lines: list[str]) -> str:
    top = _prompt_box_top_border_index(lines)
    if top is None:
        return ""
    end = len(lines)
    for i in range(top + 1, len(lines)):
        if is_horizontal_rule(lines[i]):
            end = i
            break
    return "\n".join(lines[top + 1:end])


def _codex_prompt_line(line: str) -> bool:
    return line == "›" or line.startswith("› ")


def _after_last_prompt_marker(lines: list[str], content: str) -> str:
    index = None
    for i in range(len(lines) - 1, -1, -1):
        if _codex_prompt_line(lines[i]):
            index = i
            break
    if index is None:
        return content
    return "\n".join(lines[index + 1:])


_REGION_COUNT_RE = re.compile(r"^bottom_non_empty_lines\((\d+)\)$")


def region_text(region: str, screen: str, osc_title: str, osc_progress: str) -> str:
    """ルールの region 指定に対応するテキストを返す。未実装リージョンは空文字。"""
    if region == "osc_title":
        return osc_title
    if region == "osc_progress":
        return osc_progress
    if region == "whole_recent":
        return screen
    lines = _lines(screen)
    if region == "after_last_horizontal_rule":
        return _after_last_horizontal_rule(lines)
    if region == "prompt_box_body":
        return _prompt_box_body(lines)
    if region == "after_last_prompt_marker":
        return _after_last_prompt_marker(lines, screen)
    m = _REGION_COUNT_RE.match(region)
    if m:
        return _bottom_non_empty_lines(lines, int(m.group(1)))
    return ""


# ─── ゲート評価 ──────────────────────────────────────────────────────────────

def _gate_matches(gate: Gate, text: str, lower_text: str) -> bool:
    if not all(needle in lower_text for needle in gate.contains):
        return False
    if not all(regex.search(text) for regex in gate.regex):
        return False
    if gate.line_regex:
        lines = _lines(text)
        if not all(any(regex.search(line) for line in lines) for regex in gate.line_regex):
            return False
    if not all(_gate_matches(g, text, lower_text) for g in gate.all_gates):
        return False
    if gate.any_gates and not any(_gate_matches(g, text, lower_text) for g in gate.any_gates):
        return False
    if any(_gate_matches(g, text, lower_text) for g in gate.not_gates):
        return False
    return True


def evaluate_state(
    manifest: Manifest,
    screen: str,
    osc_title: str = "",
    osc_progress: str = "",
) -> str | None:
    """マニフェストを評価して状態文字列を返す。確定できない場合は None。"""
    best: Rule | None = None
    for rule in manifest.rules:
        text = region_text(rule.region, screen, osc_title, osc_progress)
        if not _gate_matches(rule.gate, text, text.lower()):
            continue
        if best is None or rule.priority > best.priority:
            best = rule
    if best is None or best.skip_state_update:
        return None
    return best.state
