"""screen manifest 評価エンジン（api/screen_manifest.py）のテスト。

同梱マニフェスト（api/agent_manifests/ — herdr 由来）の検証と、
herdr の manifest.rs に合わせた評価意味論の確認。
"""

import pytest

from api.screen_manifest import (
    _REGION_COUNT_RE,
    Gate,
    Manifest,
    Rule,
    _gate_matches,
    compare_manifest_versions,
    evaluate_state,
    identify_agent,
    invalidate_manifest_cache,
    is_horizontal_rule,
    load_manifests,
    parse_manifest_text,
    parse_manifest_version,
    region_text,
    translate_rust_regex,
)

_SUPPORTED_REGIONS = {
    "whole_recent", "after_last_horizontal_rule", "prompt_box_body",
    "after_last_prompt_marker", "osc_title", "osc_progress",
}
_KNOWN_STATES = {"working", "idle", "blocked", "unknown"}


def _gate(**kwargs) -> Gate:
    defaults = dict(contains=[], regex=[], line_regex=[],
                    all_gates=[], any_gates=[], not_gates=[])
    defaults.update(kwargs)
    return Gate(**defaults)


def _rule(state="blocked", priority=100, region="whole_recent",
          skip_state_update=False, gate=None, rule_id="r") -> Rule:
    return Rule(id=rule_id, state=state, priority=priority, region=region,
                skip_state_update=skip_state_update, gate=gate or _gate())


class TestTranslateRustRegex:
    def test_bmp_escape_is_converted(self):
        assert translate_rust_regex(r"^[\x{2800}-\x{28FF}] ") == "^[\\u2800-\\u28ff] "

    def test_astral_escape_uses_wide_form(self):
        assert translate_rust_regex(r"\x{1F600}") == "\\U0001f600"

    def test_plain_pattern_is_unchanged(self):
        assert translate_rust_regex(r"(?i)^\s*yes\b") == r"(?i)^\s*yes\b"

    def test_braced_u_escape_is_converted(self):
        assert translate_rust_regex(r"^⚠[\u{fe0e}\u{fe0f}]?") == "^⚠[\\ufe0e\\ufe0f]?"

    def test_alphabetic_property_is_converted(self):
        import re
        pattern = translate_rust_regex(r"^\s*[\x{2800}-\x{28FF}]+\s+\p{Alphabetic}+\w*ing\b")
        assert re.search(pattern, "  ⠋ Thinking")


class TestManifestVersion:
    def test_parse_dotted_numeric(self):
        assert parse_manifest_version("2026.08.04.1") == (2026, 8, 4, 1)

    def test_parse_rejects_non_numeric(self):
        with pytest.raises(ValueError):
            parse_manifest_version("1.2a")
        with pytest.raises(ValueError):
            parse_manifest_version("")
        with pytest.raises(ValueError):
            parse_manifest_version("1..2")

    def test_compare_pads_trailing_zeros(self):
        assert compare_manifest_versions((1, 2), (1, 2, 0)) == 0
        assert compare_manifest_versions((1, 2, 1), (1, 2)) == 1
        assert compare_manifest_versions((1, 2), (1, 10)) == -1


class TestIsHorizontalRule:
    def test_rule_line(self):
        assert is_horizontal_rule("────────")

    def test_rule_with_suffix_needs_three_chars(self):
        assert is_horizontal_rule("─── title")
        assert not is_horizontal_rule("─ title")

    def test_non_rule_lines(self):
        assert not is_horizontal_rule("")
        assert not is_horizontal_rule("  hello")


class TestRegionText:
    def test_whole_recent_returns_screen(self):
        assert region_text("whole_recent", "a\nb", "t", "p") == "a\nb"

    def test_osc_regions_use_dedicated_inputs(self):
        assert region_text("osc_title", "screen", "title", "prog") == "title"
        assert region_text("osc_progress", "screen", "title", "prog") == "prog"

    def test_bottom_non_empty_lines_includes_trailing_blanks(self):
        screen = "one\ntwo\n\nthree\n\n"
        assert region_text("bottom_non_empty_lines(2)", screen, "", "") == "two\n\nthree\n"

    def test_bottom_non_empty_lines_empty_screen(self):
        assert region_text("bottom_non_empty_lines(3)", "\n\n", "", "") == ""

    def test_after_last_horizontal_rule(self):
        screen = "output\n────\nprompt line\nmore"
        assert region_text("after_last_horizontal_rule", screen, "", "") == "prompt line\nmore"

    def test_after_last_horizontal_rule_without_rule_returns_all(self):
        assert region_text("after_last_horizontal_rule", "a\nb", "", "") == "a\nb"

    def test_prompt_box_body_between_borders(self):
        screen = "output\n────\n❯ draft text\n────\nhint"
        assert region_text("prompt_box_body", screen, "", "") == "❯ draft text"

    def test_prompt_box_body_requires_two_borders(self):
        assert region_text("prompt_box_body", "────\ntext", "", "") == ""

    def test_after_last_prompt_marker(self):
        screen = "old\n› question\nanswer area"
        assert region_text("after_last_prompt_marker", screen, "", "") == "answer area"

    def test_after_last_prompt_marker_without_marker_returns_all(self):
        assert region_text("after_last_prompt_marker", "a\nb", "", "") == "a\nb"

    def test_top_non_empty_lines_includes_leading_blanks(self):
        screen = "\nfirst\nsecond\nthird"
        assert region_text("top_non_empty_lines(2)", screen, "", "") == "\nfirst\nsecond"

    def test_top_non_empty_lines_empty_screen(self):
        assert region_text("top_non_empty_lines(1)", "\n\n", "", "") == ""

    def test_bottom_lines_counts_raw_lines(self):
        assert region_text("bottom_lines(2)", "a\nb\nc\n", "", "") == "b\nc"

    def test_unknown_region_is_empty(self):
        assert region_text("osc_hyperlink", "screen", "t", "p") == ""


class TestGateMatches:
    def _matches(self, gate: Gate, text: str) -> bool:
        return _gate_matches(gate, text, text.lower())

    def test_contains_is_case_insensitive_and(self):
        gate = _gate(contains=["do you want", "esc to cancel"])
        assert self._matches(gate, "Do you WANT to proceed? esc to cancel")
        assert not self._matches(gate, "Do you want to proceed?")

    def test_line_regex_requires_some_line_per_pattern(self):
        import re
        gate = _gate(line_regex=[re.compile(r"^\s*❯")])
        assert self._matches(gate, "output\n  ❯ 1. Yes")
        assert not self._matches(gate, "output ❯ inline")

    def test_any_is_or(self):
        gate = _gate(any_gates=[_gate(contains=["aaa"]), _gate(contains=["bbb"])])
        assert self._matches(gate, "xx bbb yy")
        assert not self._matches(gate, "xx yy")

    def test_not_rejects(self):
        gate = _gate(contains=["yes"], not_gates=[_gate(contains=["never"])])
        assert self._matches(gate, "yes")
        assert not self._matches(gate, "yes never")


class TestEvaluateState:
    def test_highest_priority_wins(self):
        manifest = Manifest(id="x", aliases=[], rules=[
            _rule(state="idle", priority=100, gate=_gate(contains=["a"])),
            _rule(state="blocked", priority=200, gate=_gate(contains=["a"])),
        ])
        assert evaluate_state(manifest, "a") == "blocked"

    def test_equal_priority_keeps_first(self):
        manifest = Manifest(id="x", aliases=[], rules=[
            _rule(state="idle", priority=100, gate=_gate(contains=["a"])),
            _rule(state="blocked", priority=100, gate=_gate(contains=["a"])),
        ])
        assert evaluate_state(manifest, "a") == "idle"

    def test_skip_state_update_returns_none(self):
        manifest = Manifest(id="x", aliases=[], rules=[
            _rule(state="blocked", priority=100, gate=_gate(contains=["a"])),
            _rule(state="unknown", priority=200, skip_state_update=True,
                  gate=_gate(contains=["a"])),
        ])
        assert evaluate_state(manifest, "a") is None

    def test_no_match_returns_none(self):
        manifest = Manifest(id="x", aliases=[], rules=[
            _rule(gate=_gate(contains=["missing"])),
        ])
        assert evaluate_state(manifest, "other text") is None


class TestBundledManifests:
    def test_claude_and_codex_load(self):
        ids = {m.id for m in load_manifests()}
        assert {"claude", "codex"} <= ids

    def test_all_bundled_manifests_load(self):
        # \p{...} 等の Rust regex 記法が翻訳できず黙って捨てられていないか検証する。
        from api.screen_manifest import MANIFEST_DIR
        toml_count = len(list(MANIFEST_DIR.glob("*.toml")))
        assert len(load_manifests()) == toml_count
        ids = [m.id for m in load_manifests()]
        assert len(ids) == len(set(ids)), "duplicate manifest ids"

    def test_all_rules_use_supported_regions_and_states(self):
        # upstream 同期でリージョン・状態が増えた場合にここで検出する
        # （未知リージョンは空文字となり、ルールが黙って死ぬため）。
        for manifest in load_manifests():
            for rule in manifest.rules:
                region = rule.region
                assert region in _SUPPORTED_REGIONS or _REGION_COUNT_RE.match(region), \
                    f"{manifest.id}:{rule.id} uses unsupported region {region}"
                assert rule.state in _KNOWN_STATES, \
                    f"{manifest.id}:{rule.id} has unknown state {rule.state}"

    def test_identify_agent(self):
        assert identify_agent("claude") is not None
        assert identify_agent("claude").id == "claude"
        assert identify_agent("claude-code").id == "claude"
        assert identify_agent("/usr/local/bin/codex").id == "codex"
        assert identify_agent("Codex").id == "codex"
        assert identify_agent("bash") is None
        assert identify_agent("") is None
        assert identify_agent(None) is None

    def test_claude_permission_prompt_is_blocked(self):
        claude = identify_agent("claude")
        screen = (
            "Running command...\n"
            "──────────────────────────────\n"
            "Do you want to proceed?\n"
            "❯ 1. Yes\n"
            "  2. No\n"
            "esc to cancel\n"
        )
        assert evaluate_state(claude, screen) == "blocked"

    def test_claude_prompt_box_is_idle(self):
        claude = identify_agent("claude")
        screen = (
            "Some previous output\n"
            "──────────────────────────────\n"
            "❯ \n"
            "──────────────────────────────\n"
            "  ? for shortcuts\n"
        )
        assert evaluate_state(claude, screen) == "idle"

    def test_claude_model_picker_is_guarded(self):
        # skip_state_update ガード: モデル選択メニューを blocked と誤検知しない。
        claude = identify_agent("claude")
        screen = (
            "Select Model\n"
            "❯ 1. Sonnet\n"
            "  2. Opus\n"
            "Enter to set as default · esc to cancel\n"
        )
        assert evaluate_state(claude, screen) is None

    def test_claude_osc_title_spinner_is_working(self):
        claude = identify_agent("claude")
        assert evaluate_state(claude, "", osc_title="⠋ Thinking...") == "working"

    def test_codex_confirm_prompt_is_blocked(self):
        codex = identify_agent("codex")
        screen = "Apply this patch?\nPress Enter to confirm or Esc to cancel\n"
        assert evaluate_state(codex, screen) == "blocked"

    def test_codex_osc_title_action_required_is_blocked(self):
        codex = identify_agent("codex")
        assert evaluate_state(codex, "", osc_title="Action Required: approve") == "blocked"

    def test_plain_shell_screen_has_no_state(self):
        claude = identify_agent("claude")
        assert evaluate_state(claude, "$ ls\nREADME.md\n$ ") is None


_OVERRIDE_MANIFEST = """\
id = "claude"
[[rules]]
id = "custom"
state = "blocked"
priority = 10
region = "whole_recent"
contains = ["my custom marker"]
"""

_REMOTE_MANIFEST = """\
id = "claude"
version = "9999.1.1"
min_engine_version = 2
[[rules]]
id = "remote_rule"
state = "blocked"
priority = 10
region = "whole_recent"
contains = ["remote marker"]
"""


class TestLayeredLoading:
    """override > remote > bundled の階層解決（data/agent-detection/ 配下）。"""

    def _claude(self):
        invalidate_manifest_cache()
        manifest = identify_agent("claude")
        assert manifest is not None
        return manifest

    def _write(self, directory, name, content):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / name).write_text(content, encoding="utf-8")

    def test_bundled_is_default_source(self):
        assert self._claude().source == "bundled"

    def test_override_wins(self, isolate_fs):
        import api.screen_manifest as sm
        self._write(sm.OVERRIDE_DIR, "claude.toml", _OVERRIDE_MANIFEST)
        manifest = self._claude()
        assert manifest.source == "override"
        assert evaluate_state(manifest, "my custom marker") == "blocked"

    def test_remote_newer_than_bundled_wins(self, isolate_fs):
        import api.screen_manifest as sm
        self._write(sm.REMOTE_DIR, "claude.toml", _REMOTE_MANIFEST)
        manifest = self._claude()
        assert manifest.source == "remote"
        assert evaluate_state(manifest, "remote marker") == "blocked"

    def test_remote_older_than_bundled_is_ignored(self, isolate_fs):
        import api.screen_manifest as sm
        old = _REMOTE_MANIFEST.replace('version = "9999.1.1"', 'version = "1.0.0"')
        self._write(sm.REMOTE_DIR, "claude.toml", old)
        assert self._claude().source == "bundled"

    def test_override_beats_remote(self, isolate_fs):
        import api.screen_manifest as sm
        self._write(sm.REMOTE_DIR, "claude.toml", _REMOTE_MANIFEST)
        self._write(sm.OVERRIDE_DIR, "claude.toml", _OVERRIDE_MANIFEST)
        assert self._claude().source == "override"

    def test_broken_override_falls_back(self, isolate_fs):
        import api.screen_manifest as sm
        self._write(sm.OVERRIDE_DIR, "claude.toml", "not [valid toml")
        assert self._claude().source == "bundled"

    def test_override_with_wrong_id_falls_back(self, isolate_fs):
        import api.screen_manifest as sm
        self._write(sm.OVERRIDE_DIR, "claude.toml",
                    _OVERRIDE_MANIFEST.replace('id = "claude"', 'id = "other"'))
        assert self._claude().source == "bundled"

    def test_remote_without_required_fields_is_ignored(self, isolate_fs):
        import api.screen_manifest as sm
        # remote 階層は version / min_engine_version が必須（herdr と同じ）
        self._write(sm.REMOTE_DIR, "claude.toml", _OVERRIDE_MANIFEST)
        assert self._claude().source == "bundled"

    def test_cache_returns_same_until_invalidated(self, isolate_fs):
        import api.screen_manifest as sm
        assert self._claude().source == "bundled"
        self._write(sm.OVERRIDE_DIR, "claude.toml", _OVERRIDE_MANIFEST)
        # invalidate せずに読むとキャッシュが生きている
        cached = identify_agent("claude")
        assert cached is not None and cached.source == "bundled"
        invalidate_manifest_cache()
        fresh = identify_agent("claude")
        assert fresh is not None and fresh.source == "override"


class TestEngineVersionGate:
    def test_manifest_requiring_newer_engine_is_rejected(self):
        content = _REMOTE_MANIFEST.replace("min_engine_version = 2", "min_engine_version = 99")
        with pytest.raises(ValueError):
            parse_manifest_text(content, require_remote_fields=True)

    def test_remote_fields_are_required(self):
        with pytest.raises(ValueError):
            parse_manifest_text(_OVERRIDE_MANIFEST, require_remote_fields=True)

    def test_missing_id_is_rejected(self):
        with pytest.raises(ValueError):
            parse_manifest_text("[[rules]]\nid = \"r\"\n")
