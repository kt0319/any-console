"""ジョブ照合（api/job_match.py）のテスト。"""

from api.job_match import (
    build_job_patterns,
    command_steps,
    match_job,
    step_to_pattern,
)
from api.job_models import JobDefinition


def _patterns(commands: dict[str, str]):
    return build_job_patterns({
        name: JobDefinition(command=command, label=name)
        for name, command in commands.items()
    })


class TestCommandSteps:
    def test_splits_on_and_and_semicolon_and_newline(self):
        assert command_steps("cd sub && npm run dev") == ["cd sub", "npm run dev"]
        assert command_steps("a; b\nc") == ["a", "b", "c"]

    def test_strips_comment_lines_and_blank_steps(self):
        assert command_steps("# comment\nnpm test\n\n") == ["npm test"]

    def test_normalizes_whitespace(self):
        assert command_steps("npm   run\tdev") == ["npm run dev"]


class TestStepToPattern:
    def test_placeholder_becomes_wildcard(self):
        pattern = step_to_pattern("git checkout [[branch]]")
        assert pattern.fullmatch("git checkout feature/x")
        assert not pattern.fullmatch("git checkout")

    def test_literal_regex_chars_are_escaped(self):
        pattern = step_to_pattern("echo a.b*")
        assert pattern.fullmatch("echo a.b*")
        assert not pattern.fullmatch("echo aXbY")


class TestMatchJob:
    def test_exact_match_only(self):
        patterns = _patterns({"dev": "npm run dev"})
        assert match_job([["npm", "run", "dev"]], patterns).name == "dev"
        # 前方一致・部分一致は採用しない
        assert match_job([["npm", "run", "dev:watch"]], patterns) is None
        assert match_job([["npm", "run"]], patterns) is None

    def test_any_process_in_group_can_match(self):
        patterns = _patterns({"dev": "npm run dev"})
        argvs = [["node", "/usr/lib/vite"], ["npm", "run", "dev"]]
        assert match_job(argvs, patterns).name == "dev"

    def test_multi_step_command_matches_by_step(self):
        patterns = _patterns({"dev": "cd sub && npm run dev"})
        assert match_job([["npm", "run", "dev"]], patterns).name == "dev"

    def test_placeholder_command(self):
        patterns = _patterns({"co": "git checkout [[branch]]"})
        assert match_job([["git", "checkout", "main"]], patterns).name == "co"

    def test_empty_inputs(self):
        assert match_job([], _patterns({"dev": "npm run dev"})) is None
        assert match_job([["npm", "run", "dev"]], []) is None

    def test_jobs_without_command_are_excluded(self):
        assert _patterns({"empty": "", "comment_only": "# note"}) == []
