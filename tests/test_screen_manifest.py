"""screen manifest 評価エンジン（api/screen_manifest.py）のテスト。

同梱マニフェスト（api/agent_manifests/ — herdr 由来）の検証と、
herdr の manifest.rs に合わせた評価意味論の確認。
"""

from api.screen_manifest import (
    Gate,
    Manifest,
    Rule,
    _gate_matches,
    evaluate_state,
    identify_agent,
    is_horizontal_rule,
    load_manifests,
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

    def test_all_rules_use_supported_regions_and_states(self):
        # upstream 同期でリージョン・状態が増えた場合にここで検出する
        # （未知リージョンは空文字となり、ルールが黙って死ぬため）。
        for manifest in load_manifests():
            for rule in manifest.rules:
                region = rule.region
                base = region.split("(")[0] + "(n)" if "(" in region else region
                assert region in _SUPPORTED_REGIONS or base == "bottom_non_empty_lines(n)", \
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
