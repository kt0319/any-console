"""screen manifest リモート更新（api/manifest_update.py）のテスト。"""

import pytest

from api import manifest_update
from api.manifest_update import (
    ManifestUpdateError,
    check_and_update,
    load_status,
    parse_catalog,
    process_agent_manifest,
    remote_update_enabled,
)

_CATALOG = """\
schema_version = 1

[[agents]]
id = "claude"
path = "claude.toml"

[[agents]]
id = "not-a-known-agent"
path = "unknown.toml"
"""

_REMOTE_CLAUDE = """\
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


class TestParseCatalog:
    def test_valid_catalog_skips_unknown_agents(self):
        assert parse_catalog(_CATALOG) == [("claude", "claude.toml")]

    def test_rejects_wrong_schema_version(self):
        with pytest.raises(ManifestUpdateError):
            parse_catalog("schema_version = 2\n")

    def test_rejects_invalid_toml(self):
        with pytest.raises(ManifestUpdateError):
            parse_catalog("not [valid")

    def test_rejects_unsafe_paths(self):
        for path in ["/abs/claude.toml", "https://evil/x.toml", "../escape.toml", "a/../b.toml"]:
            catalog = f'schema_version = 1\n[[agents]]\nid = "claude"\npath = "{path}"\n'
            with pytest.raises(ManifestUpdateError):
                parse_catalog(catalog)

    def test_rejects_empty_path(self):
        with pytest.raises(ManifestUpdateError):
            parse_catalog('schema_version = 1\n[[agents]]\nid = "claude"\npath = ""\n')

    def test_rejects_duplicate_agent(self):
        catalog = (
            'schema_version = 1\n'
            '[[agents]]\nid = "claude"\npath = "a.toml"\n'
            '[[agents]]\nid = "claude"\npath = "b.toml"\n'
        )
        with pytest.raises(ManifestUpdateError):
            parse_catalog(catalog)


class TestProcessAgentManifest:
    def test_commits_new_manifest(self, isolate_fs):
        import api.screen_manifest as sm
        assert process_agent_manifest("claude", _REMOTE_CLAUDE) is True
        assert (sm.REMOTE_DIR / "claude.toml").read_text(encoding="utf-8") == _REMOTE_CLAUDE

    def test_rejects_id_mismatch(self):
        with pytest.raises(ManifestUpdateError):
            process_agent_manifest("codex", _REMOTE_CLAUDE)

    def test_rejects_missing_required_fields(self):
        with pytest.raises(ManifestUpdateError):
            process_agent_manifest("claude", 'id = "claude"\n')

    def test_rejects_engine_version_too_new(self):
        content = _REMOTE_CLAUDE.replace("min_engine_version = 2", "min_engine_version = 99")
        with pytest.raises(ManifestUpdateError):
            process_agent_manifest("claude", content)

    def test_rejects_older_than_cached(self, isolate_fs):
        process_agent_manifest("claude", _REMOTE_CLAUDE)
        older = _REMOTE_CLAUDE.replace('version = "9999.1.1"', 'version = "9999.1.0"')
        with pytest.raises(ManifestUpdateError):
            process_agent_manifest("claude", older)

    def test_same_version_same_content_is_noop(self, isolate_fs):
        process_agent_manifest("claude", _REMOTE_CLAUDE)
        assert process_agent_manifest("claude", _REMOTE_CLAUDE) is False

    def test_same_version_changed_content_is_rejected(self, isolate_fs):
        process_agent_manifest("claude", _REMOTE_CLAUDE)
        changed = _REMOTE_CLAUDE.replace("remote marker", "tampered marker")
        with pytest.raises(ManifestUpdateError):
            process_agent_manifest("claude", changed)


class TestCheckAndUpdate:
    def _fetch(self, mapping):
        def fetch(url):
            for suffix, content in mapping.items():
                if url.endswith(suffix):
                    return content
            raise ManifestUpdateError(f"fetch failed for {url}: 404")
        return fetch

    def test_updates_and_records_status(self, isolate_fs):
        from api.screen_manifest import identify_agent, invalidate_manifest_cache
        status = check_and_update(self._fetch({
            "index.toml": _CATALOG, "claude.toml": _REMOTE_CLAUDE,
        }))
        assert status["last_result"] == "checked"
        assert status["agents"]["claude"]["last_result"] == "updated"
        assert status["agents"]["claude"]["cached_version"] == "9999.1.1"
        # コミット後はキャッシュが破棄され、次のロードで remote が有効になる
        manifest = identify_agent("claude")
        assert manifest is not None and manifest.source == "remote"
        # 永続化された status も読み直せる
        assert load_status()["last_result"] == "checked"
        invalidate_manifest_cache()

    def test_second_run_is_unchanged(self, isolate_fs):
        fetch = self._fetch({"index.toml": _CATALOG, "claude.toml": _REMOTE_CLAUDE})
        check_and_update(fetch)
        status = check_and_update(fetch)
        assert status["agents"]["claude"]["last_result"] == "unchanged"

    def test_catalog_fetch_failure_is_recorded(self, isolate_fs):
        status = check_and_update(self._fetch({}))
        assert str(status["last_result"]).startswith("failed:")

    def test_agent_failure_does_not_abort_run(self, isolate_fs):
        catalog = (
            'schema_version = 1\n'
            '[[agents]]\nid = "claude"\npath = "claude.toml"\n'
            '[[agents]]\nid = "codex"\npath = "codex.toml"\n'
        )
        status = check_and_update(self._fetch({
            "index.toml": catalog,
            "claude.toml": 'id = "claude"\n',  # 必須フィールド欠落 → 失敗
            "codex.toml": _REMOTE_CLAUDE.replace('id = "claude"', 'id = "codex"'),
        }))
        assert status["last_result"] == "checked"
        assert status["agents"]["claude"]["last_result"] == "failed"
        assert "invalid manifest" in status["agents"]["claude"]["last_error"]
        assert status["agents"]["codex"]["last_result"] == "updated"


class TestRemoteUpdateEnabled:
    def test_default_is_enabled(self, client):
        assert remote_update_enabled() is True

    def test_config_can_disable(self, client, isolate_fs):
        import json
        isolate_fs["config_file"].write_text(json.dumps({
            "__global__": {"agent_detection": {"remote_update": False}},
        }))
        assert remote_update_enabled() is False

    def test_broken_config_defaults_to_enabled(self, client, isolate_fs):
        import json
        isolate_fs["config_file"].write_text(json.dumps({
            "__global__": {"agent_detection": "broken"},
        }))
        assert remote_update_enabled() is True


class TestCatalogUrl:
    def test_env_override(self, monkeypatch):
        monkeypatch.setenv(manifest_update.CATALOG_URL_ENV, "https://example.com/idx.toml")
        assert manifest_update.catalog_url() == "https://example.com/idx.toml"

    def test_default(self, monkeypatch):
        monkeypatch.delenv(manifest_update.CATALOG_URL_ENV, raising=False)
        assert manifest_update.catalog_url() == manifest_update.DEFAULT_CATALOG_URL

    def test_base_url(self):
        assert manifest_update._base_url("https://x.dev/a/index.toml") == "https://x.dev/a"
        with pytest.raises(ManifestUpdateError):
            manifest_update._base_url("https://x.dev")
