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
を渡す。

マニフェストは herdr と同じ 3 階層で解決する（優先度の高い順）:

1. ローカル override: `data/agent-detection/<id>.toml`（ユーザーが手で置く）
2. リモートキャッシュ: `data/agent-detection/remote/<id>.toml`
   （`api/manifest_update.py` が herdr.dev から取得・検証して保存する。
   バージョンが同梱版より古い場合は無視する）
3. 同梱: `api/agent_manifests/*.toml`（読み取り専用のパッケージデータであり
   `DATA_DIR` 隔離の対象外。1・2 は状態ファイルなので `DATA_DIR` 配下）

上位階層が壊れている・id が一致しない場合は下位階層へフォールバックする。
"""

from __future__ import annotations

import logging
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from .common import DATA_DIR, SCREEN_MANIFEST_CACHE_TTL_SEC, TTLCache

logger = logging.getLogger(__name__)

MANIFEST_DIR = Path(__file__).parent / "agent_manifests"
# ローカル override とリモートキャッシュ（manifest_update.py が書く）の置き場。
# isolate_fs / ANY_CONSOLE_DATA_DIR による隔離対象なので DATA_DIR 経由で組み立てる。
OVERRIDE_DIR = DATA_DIR / "agent-detection"
REMOTE_DIR = DATA_DIR / "agent-detection" / "remote"

# マニフェスト読み込み時に「その階層だけ捨てる」対象の例外（parse_manifest_text の
# 送出系 + ファイル IO）。
MANIFEST_LOAD_ERRORS = (OSError, tomllib.TOMLDecodeError, re.error, ValueError, TypeError)


def remote_manifest_path(agent_id: str) -> Path:
    """remote 層のマニフェスト保存先（manifest_update.py の書き込み先と共有）。"""
    return REMOTE_DIR / f"{agent_id}.toml"


def override_manifest_path(agent_id: str) -> Path:
    return OVERRIDE_DIR / f"{agent_id}.toml"

# herdr の MANIFEST_ENGINE_VERSION に対応。top_non_empty_lines 対応が v3。
ENGINE_VERSION = 3

STATE_WORKING = "working"
STATE_IDLE = "idle"
STATE_BLOCKED = "blocked"
STATE_UNKNOWN = "unknown"
# agent_watch がセッション状態として採用する manifest 判定（unknown は採用しない）
ADOPTED_STATES = frozenset({STATE_WORKING, STATE_IDLE, STATE_BLOCKED})

# Rust regex の波括弧 Unicode エスケープ（\x{...} と \u{...} は等価）
_RUST_UNICODE_ESCAPE_RE = re.compile(r"\\[xu]\{([0-9A-Fa-f]{1,6})\}")
# Rust regex の Unicode プロパティクラス。Python re は \p{...} 非対応のため
# 既知のものだけ等価な表現へ置き換える。未知のプロパティは変換せず残し、
# re.compile が失敗してマニフェスト単位で捨てられる（fail-safe）。
_RUST_PROPERTY_EQUIVALENTS = {
    r"\p{Alphabetic}": r"[^\W\d_]",
}


def translate_rust_regex(pattern: str) -> str:
    """Rust regex 固有の記法を Python `re` の形式へ変換する。"""
    for prop, equivalent in _RUST_PROPERTY_EQUIVALENTS.items():
        pattern = pattern.replace(prop, equivalent)

    def repl(m: re.Match[str]) -> str:
        cp = int(m.group(1), 16)
        if cp <= 0xFFFF:
            return f"\\u{cp:04x}"
        return f"\\U{cp:08x}"

    return _RUST_UNICODE_ESCAPE_RE.sub(repl, pattern)


def parse_manifest_version(value: str) -> tuple[int, ...]:
    """ドット区切り数値バージョンをパースする（herdr の ManifestVersion 相当）。

    数値以外・空セグメントは ValueError。比較は compare_manifest_versions で行う。
    """
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("version must not be empty")
    segments = []
    for segment in trimmed.split("."):
        if not segment or not segment.isascii() or not segment.isdigit():
            raise ValueError(f"version {trimmed!r} must be dotted numeric")
        segments.append(int(segment))
    return tuple(segments)


def compare_manifest_versions(left: tuple[int, ...], right: tuple[int, ...]) -> int:
    """-1 / 0 / 1 を返す。桁数が違う場合は 0 を補って比較する（1.2 == 1.2.0）。"""
    length = max(len(left), len(right))
    padded_left = left + (0,) * (length - len(left))
    padded_right = right + (0,) * (length - len(right))
    if padded_left < padded_right:
        return -1
    if padded_left > padded_right:
        return 1
    return 0


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
    version: tuple[int, ...] | None = None
    min_engine_version: int | None = None
    source: str = "bundled"  # "bundled" | "remote" | "override"


def _compile_gate(raw: dict) -> Gate:
    return Gate(
        contains=[str(s).lower() for s in raw.get("contains", [])],
        regex=[re.compile(translate_rust_regex(str(p))) for p in raw.get("regex", [])],
        line_regex=[re.compile(translate_rust_regex(str(p))) for p in raw.get("line_regex", [])],
        all_gates=[_compile_gate(g) for g in raw.get("all", [])],
        any_gates=[_compile_gate(g) for g in raw.get("any", [])],
        not_gates=[_compile_gate(g) for g in raw.get("not", [])],
    )


def _compile_manifest(raw: dict, *, source: str = "bundled", require_remote_fields: bool = False) -> Manifest:
    """パース + コンパイルし、エンジンバージョンを検証する。

    require_remote_fields=True（リモート由来）では herdr と同じく version と
    min_engine_version を必須にする（バージョン比較・互換判定に必要なため）。
    """
    version_raw = raw.get("version")
    version = parse_manifest_version(str(version_raw)) if version_raw is not None else None
    min_engine_raw = raw.get("min_engine_version")
    min_engine = int(min_engine_raw) if min_engine_raw is not None else None
    if require_remote_fields:
        if version is None:
            raise ValueError("remote manifest must include version")
        if min_engine is None:
            raise ValueError("remote manifest must include min_engine_version")
    if min_engine is not None and min_engine > ENGINE_VERSION:
        raise ValueError(
            f"manifest requires engine {min_engine}, current engine is {ENGINE_VERSION}")
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
        version=version,
        min_engine_version=min_engine,
        source=source,
    )


def parse_manifest_text(
    content: str, *, source: str = "bundled", require_remote_fields: bool = False,
) -> Manifest:
    """TOML 文字列からマニフェストを構築する（manifest_update.py の検証にも使う）。

    失敗は tomllib.TOMLDecodeError / re.error / ValueError / TypeError で送出。
    """
    raw = tomllib.loads(content)
    manifest = _compile_manifest(raw, source=source, require_remote_fields=require_remote_fields)
    if not manifest.id:
        raise ValueError("manifest is missing id")
    return manifest


def _load_layer(
    path: Path, bundled_id: str, *, source: str, require_remote_fields: bool = False,
) -> Manifest | None:
    """remote / override の 1 階層を読み込む。無い・壊れている場合は None。"""
    if not path.is_file():
        return None
    try:
        manifest = parse_manifest_text(
            path.read_text(encoding="utf-8"), source=source,
            require_remote_fields=require_remote_fields,
        )
        if manifest.id != bundled_id:
            raise ValueError(
                f"{source} manifest id {manifest.id!r} does not match {bundled_id!r}")
        return manifest
    except MANIFEST_LOAD_ERRORS as e:
        logger.warning("ignored %s manifest %s: %s", source, path.name, e)
        return None


def _load_layered_manifest(path: Path) -> Manifest | None:
    """同梱 1 ファイルを起点に override > remote > bundled の順で解決する。

    1 ファイルでも壊れていたらその階層だけ捨てて下位へフォールバックする
    （fail-safe: 検知しない側へ倒す）。ルール単位のスキップはしない — ガード用
    ルール（skip_state_update / unknown）が欠けると誤検知側へ倒れるため、
    ファイル単位で全捨てする。
    """
    try:
        bundled = parse_manifest_text(path.read_text(encoding="utf-8"), source="bundled")
    except MANIFEST_LOAD_ERRORS as e:
        logger.warning("screen manifest load failed file=%s: %s", path.name, e)
        return None

    # remote / override の探索はファイル名ではなく id 基準（herdr の agent_label 相当。
    # 同梱ファイル名と id は一致しないことがある: antigravity.toml → id "agy" 等）。
    resolved = bundled
    remote = _load_layer(
        remote_manifest_path(bundled.id), bundled.id,
        source="remote", require_remote_fields=True,
    )
    if remote is not None:
        if (bundled.version is not None and remote.version is not None
                and compare_manifest_versions(remote.version, bundled.version) < 0):
            logger.info(
                "ignored remote manifest %s: cached version is older than bundled",
                remote_manifest_path(bundled.id).name)
        else:
            resolved = remote

    override = _load_layer(override_manifest_path(bundled.id), bundled.id, source="override")
    if override is not None:
        resolved = override

    return resolved


_manifest_cache = TTLCache(SCREEN_MANIFEST_CACHE_TTL_SEC)
_MANIFEST_CACHE_KEY = "manifests"


def load_manifests() -> tuple[Manifest, ...]:
    """全エージェントのマニフェストを階層解決して返す（TTL キャッシュ付き）。

    認識するエージェントは同梱ファイルがあるものに限る（herdr と同じ）。
    override / remote の変更は TTL（SCREEN_MANIFEST_CACHE_TTL_SEC）経過後、
    または invalidate_manifest_cache() 呼び出しで反映される。
    """
    cached = _manifest_cache.get(_MANIFEST_CACHE_KEY)
    if cached is not None:
        return tuple(cached)
    manifests = []
    for path in sorted(MANIFEST_DIR.glob("*.toml")):
        manifest = _load_layered_manifest(path)
        if manifest is not None:
            manifests.append(manifest)
    result = tuple(manifests)
    _manifest_cache.set(_MANIFEST_CACHE_KEY, result)
    return result


def invalidate_manifest_cache() -> None:
    """リモート更新のコミット後などに階層解決キャッシュを破棄する。"""
    _manifest_cache.invalidate_all()


def _lookup_manifest(name: str) -> Manifest | None:
    for manifest in load_manifests():
        if name == manifest.id or name in manifest.aliases:
            return manifest
    return None


def _normalized_basename(token: str) -> str:
    """パス・引用符・既知の拡張子を落とした照合用の名前を返す。"""
    name = token.strip("\"'").replace("\\", "/").rsplit("/", 1)[-1].lower()
    for ext in (".js", ".mjs", ".cjs", ".py", ".exe", ".cmd"):
        if name.endswith(ext):
            return name[: -len(ext)]
    return name


def identify_agent(pane_command: str | None) -> Manifest | None:
    """tmux の `#{pane_current_command}` からエージェントのマニフェストを特定する。"""
    if not pane_command:
        return None
    name = _normalized_basename(pane_command)
    if not name:
        return None
    return _lookup_manifest(name)


# ランタイム・シェル経由の起動（`node /path/claude` 等）でエージェント名が
# argv の後方に来るもの。herdr の wrapped_agent_name_from_runtime_argv の
# Linux / macOS 向けサブセット。
_RUNTIME_NAMES = frozenset({"node", "bun", "deno", "python", "python2", "python3"})
_SHELL_NAMES = frozenset({"sh", "bash", "zsh", "fish"})
# これらのフラグが来たらスクリプト実行ではない（インライン評価）ので諦める
_RUNTIME_EVAL_FLAGS = frozenset({"-e", "--eval", "-p", "--print", "-c", "-m"})
# 値を取るフラグ（次の引数をスクリプト名と誤認しないためスキップする）
_RUNTIME_VALUE_FLAGS = frozenset({"-r", "--require", "--loader", "--import", "--experimental-loader"})


def _runtime_script_name(argv: list[str]) -> str | None:
    """ランタイム argv からスクリプト名（正規化済み basename）を取り出す。"""
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            return _normalized_basename(argv[i + 1]) if i + 1 < len(argv) else None
        if arg in _RUNTIME_EVAL_FLAGS:
            return None
        if arg.startswith("-"):
            if arg in _RUNTIME_VALUE_FLAGS:
                i += 1
            i += 1
            continue
        return _normalized_basename(arg)
    return None


def _shell_command_name(argv: list[str]) -> str | None:
    """`sh -c 'claude ...'` 形式からコマンド名を取り出す。"""
    for i, arg in enumerate(argv[1:], start=1):
        if arg == "-c" and i + 1 < len(argv):
            tokens = argv[i + 1].split()
            return _normalized_basename(tokens[0]) if tokens else None
    return None


def identify_agent_from_argvs(argvs: list[list[str]]) -> Manifest | None:
    """前面プロセスグループの argv 一覧からエージェントを特定する。

    プロセス名（`#{pane_current_command}`）で特定できないラッパー起動
    （node スクリプト・`sh -c` 等）向けのフォールバック。最初に一致した
    プロセスのマニフェストを返す。
    """
    for argv in argvs:
        if not argv:
            continue
        argv0 = _normalized_basename(argv[0])
        candidates = [argv0]
        if argv0 in _RUNTIME_NAMES:
            script = _runtime_script_name(argv)
            if script:
                candidates.append(script)
        elif argv0 in _SHELL_NAMES:
            command = _shell_command_name(argv)
            if command:
                candidates.append(command)
        for name in candidates:
            manifest = _lookup_manifest(name)
            if manifest is not None:
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


def _bottom_lines(lines: list[str], count: int) -> str:
    return "\n".join(lines[max(0, len(lines) - count):])


def _top_non_empty_lines(lines: list[str], count: int) -> str:
    end = None
    remaining = count
    for i, line in enumerate(lines):
        if line.strip():
            end = i
            remaining -= 1
            if remaining == 0:
                break
    if end is None:
        return ""
    return "\n".join(lines[:end + 1])


_REGION_COUNT_RE = re.compile(r"^(bottom_non_empty_lines|bottom_lines|top_non_empty_lines)\((\d+)\)$")


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
        count = int(m.group(2))
        if m.group(1) == "bottom_non_empty_lines":
            return _bottom_non_empty_lines(lines, count)
        if m.group(1) == "bottom_lines":
            return _bottom_lines(lines, count)
        return _top_non_empty_lines(lines, count)
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
