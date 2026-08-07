import json

import pytest
from conftest import find_ws_entry, find_ws_id


class TestConfigLoadSave:
    def test_load_empty(self, isolate_fs):
        from api.config import load_all_config
        assert load_all_config() == {}

    def test_save_and_load(self, isolate_fs):
        from api.config import save_all_config, load_all_config
        config = {
            "my-ws": {
                "icon": "mdi-star",
                "icon_color": "#ff0000",
                "hidden": False,
                "jobs": {},
            }
        }
        save_all_config(config)
        loaded = load_all_config()
        entry = find_ws_entry(loaded, "my-ws")
        assert entry["icon"] == "mdi-star"
        assert entry["icon_color"] == "#ff0000"

    def test_save_creates_parent_directory(self, isolate_fs):
        import shutil
        config_file = isolate_fs["config_file"]
        shutil.rmtree(config_file.parent, ignore_errors=True)

        from api.config import save_all_config
        save_all_config({"ws": {"icon": "", "icon_color": "", "hidden": False, "jobs": {}}})
        assert config_file.exists()

    def test_save_invalid_config_raises(self, isolate_fs):
        from api.config import save_all_config
        with pytest.raises(ValueError):
            save_all_config({"ws": {"jobs": {"bad": {"missing_command": True}}}})

    def test_load_corrupted_json_falls_back_to_empty(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text("{invalid json", encoding="utf-8")

        from api.config import load_all_config
        result = load_all_config()
        assert result == {}

    def test_load_corrupted_json_restores_from_bak(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        bak_file = config_file.with_suffix(".bak")
        bak_file.write_text(json.dumps({"ws": {"icon": "mdi-star", "icon_color": "", "hidden": False, "jobs": {}}}), encoding="utf-8")
        config_file.write_text("{invalid json", encoding="utf-8")

        from api.config import load_all_config
        result = load_all_config()
        entry = find_ws_entry(result, "ws")
        assert entry is not None
        assert entry.get("icon") == "mdi-star"
        # config.json should now be repaired
        assert json.loads(config_file.read_text()) is not None

    def test_load_filters_invalid_entries(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        raw = {
            "valid-ws": {"icon": "", "icon_color": "", "hidden": False, "jobs": {}},
            "bad-ws": {"jobs": {"j": {"no_command": True}}},
        }
        config_file.write_text(json.dumps(raw), encoding="utf-8")

        from api.config import load_all_config
        loaded = load_all_config()
        assert find_ws_id(loaded, "valid-ws") is not None
        assert find_ws_id(loaded, "bad-ws") is None

    def test_load_preserves_global_when_one_job_invalid(self, isolate_fs):
        # 不正なジョブが1つあっても __global__ 全体は捨てず、circle_keypad(サークルキーパッド)
        # や正常なジョブは保持する（無関係な設定の巻き添えリセットを防ぐ）。
        from api.common import GLOBAL_CONFIG_KEY
        from api.config import load_all_config
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        circle_keypad = {
            "keys": [{"key": "a"}] * 8,
            "specials": [{"label": "x", "action": "y"}] * 4,
            "enabled": True,
        }
        raw = {GLOBAL_CONFIG_KEY: {
            "circle_keypad": circle_keypad,
            "jobs": {"good": {"command": "ls"}, "bad": {"label": "x"}},
        }}
        config_file.write_text(json.dumps(raw), encoding="utf-8")

        loaded = load_all_config()
        g = loaded[GLOBAL_CONFIG_KEY]
        assert len(g.get("circle_keypad", {}).get("keys", [])) == 8
        assert "good" in g.get("jobs", {})
        assert "bad" not in g.get("jobs", {})

    def test_load_preserves_circle_keypad_when_snippet_invalid(self, isolate_fs):
        from api.common import GLOBAL_CONFIG_KEY
        from api.config import load_all_config
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        circle_keypad = {
            "keys": [{"key": "a"}] * 8,
            "specials": [{"label": "x", "action": "y"}] * 4,
            "enabled": True,
        }
        raw = {GLOBAL_CONFIG_KEY: {
            "circle_keypad": circle_keypad,
            "snippets": [{"label": "ok", "command": "ls"}, {"label": "bad"}],
        }}
        config_file.write_text(json.dumps(raw), encoding="utf-8")

        loaded = load_all_config()
        g = loaded[GLOBAL_CONFIG_KEY]
        assert len(g.get("circle_keypad", {}).get("keys", [])) == 8
        assert len(g.get("snippets", [])) == 1

    def test_atomic_write(self, isolate_fs):
        from api.config import save_all_config, load_all_config
        config_file = isolate_fs["config_file"]

        save_all_config({"ws": {"icon": "a", "icon_color": "", "hidden": False, "jobs": {}}})
        assert not config_file.with_suffix(".tmp").exists()
        assert config_file.exists()


class TestWorkspaceConfig:
    def test_load_workspace_config(self, isolate_fs):
        from api.config import save_all_config, load_workspace_config
        save_all_config({"ws1": {"icon": "star", "icon_color": "", "hidden": False, "jobs": {}}})

        loaded = load_workspace_config("ws1")
        assert loaded["icon"] == "star"

    def test_load_workspace_config_nonexistent(self, isolate_fs):
        from api.config import load_workspace_config
        assert load_workspace_config("no-ws") == {}

    def test_save_workspace_config(self, isolate_fs):
        from api.config import save_workspace_config, load_workspace_config
        save_workspace_config("ws1", {"icon": "folder", "icon_color": "#00f", "hidden": True, "jobs": {}})

        loaded = load_workspace_config("ws1")
        assert loaded["icon"] == "folder"
        assert loaded["hidden"] is True

    def test_save_workspace_config_preserves_others(self, isolate_fs):
        from api.config import save_all_config, save_workspace_config, load_all_config
        save_all_config({
            "ws1": {"icon": "a", "icon_color": "", "hidden": False, "jobs": {}},
            "ws2": {"icon": "b", "icon_color": "", "hidden": False, "jobs": {}},
        })

        save_workspace_config("ws1", {"icon": "updated", "icon_color": "", "hidden": False, "jobs": {}})
        loaded = load_all_config()
        assert find_ws_entry(loaded, "ws1")["icon"] == "updated"
        assert find_ws_entry(loaded, "ws2")["icon"] == "b"


class TestConfigSection:
    def test_save_and_load_workspace_section(self, isolate_fs):
        from api.config import save_workspace_config, save_workspace_config_section, load_workspace_config_section
        save_workspace_config("ws1", {"icon": "", "icon_color": "", "hidden": False, "jobs": {}})

        jobs = {"build": {"command": "make build", "label": "Build"}}
        save_workspace_config_section("ws1", "jobs", jobs)

        loaded = load_workspace_config_section("ws1", "jobs")
        assert "build" in loaded
        assert loaded["build"]["command"] == "make build"

    def test_load_section_default(self, isolate_fs):
        from api.config import load_workspace_config_section
        result = load_workspace_config_section("no-ws", "jobs")
        assert result == {}

    def test_save_and_load_global_section(self, isolate_fs):
        from api.config import save_global_config_section, load_global_config_section
        snippets = [{"label": "ls", "command": "ls -la"}]
        save_global_config_section("snippets", snippets)

        loaded = load_global_config_section("snippets")
        assert len(loaded) == 1
        assert loaded[0]["command"] == "ls -la"

    def test_global_section_preserves_other_sections(self, isolate_fs):
        from api.config import save_global_config_section, load_global_config_section
        save_global_config_section("snippets", [{"label": "a", "command": "a"}])
        save_global_config_section("workspace_order", ["ws1", "ws2"])

        assert len(load_global_config_section("snippets")) == 1
        assert load_global_config_section("workspace_order") == ["ws1", "ws2"]


class TestCompareAndUpdateGlobalConfigSection:
    def test_writes_when_current_matches_expected(self, isolate_fs):
        from api.config import compare_and_update_global_config_section, save_global_config_section, load_global_config_section
        save_global_config_section("snippets", [{"label": "a", "command": "a"}])

        expected = load_global_config_section("snippets")
        new_value = [{"label": "a", "command": "a"}, {"label": "b", "command": "b"}]
        result = compare_and_update_global_config_section("snippets", expected, new_value)

        assert result == new_value
        assert load_global_config_section("snippets") == new_value

    def test_discards_new_value_when_concurrent_write_happened(self, isolate_fs):
        """expected_current 算出後、ロック取得前に別クライアントが書き込んだ場合、
        古いスナップショットに基づく new_value で上書きしない（lost update 防止）。"""
        from api.config import compare_and_update_global_config_section, save_global_config_section, load_global_config_section
        save_global_config_section("snippets", [{"label": "a", "command": "a"}])

        stale_expected = load_global_config_section("snippets")
        # このタイミングで別クライアントが割り込んで書き込んだと仮定する
        concurrent_value = [{"label": "b", "command": "b"}]
        save_global_config_section("snippets", concurrent_value)

        result = compare_and_update_global_config_section("snippets", stale_expected, [])

        assert result == concurrent_value
        assert load_global_config_section("snippets") == concurrent_value

    def test_no_write_when_new_value_equals_current(self, isolate_fs):
        from api.config import compare_and_update_global_config_section, save_global_config_section, load_global_config_section
        save_global_config_section("snippets", [{"label": "a", "command": "a"}])

        expected = load_global_config_section("snippets")
        result = compare_and_update_global_config_section("snippets", expected, expected)

        assert result == expected
        assert load_global_config_section("snippets") == expected


class TestConfigVersionMigration:
    def test_get_version_helpers(self):
        from api.config_migrations import _get_config_version, _set_config_version
        assert _get_config_version({}) == 0
        assert _get_config_version({"__global__": {}}) == 0
        assert _get_config_version({"__global__": {"config_version": 3}}) == 3
        # 不正値・bool は旧版(0)扱い
        assert _get_config_version({"__global__": {"config_version": "x"}}) == 0
        assert _get_config_version({"__global__": {"config_version": True}}) == 0
        assert _get_config_version({"__global__": "not-a-dict"}) == 0
        stamped = _set_config_version({"__global__": {"snippets": []}}, 5)
        assert stamped["__global__"]["config_version"] == 5
        assert stamped["__global__"]["snippets"] == []

    def test_empty_config_is_not_stamped(self, isolate_fs):
        from api.config import load_all_config
        assert load_all_config() == {}
        # 初回起動でファイルを勝手に作らない
        assert not isolate_fs["config_file"].exists()

    def test_legacy_config_gets_version_stamped(self, isolate_fs):
        from api.common import CONFIG_SCHEMA_VERSION
        from api.config import load_all_config
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(
            json.dumps({"__global__": {"snippets": [{"label": "ls", "command": "ls"}]}}),
            encoding="utf-8",
        )

        loaded = load_all_config()
        assert loaded["__global__"]["config_version"] == CONFIG_SCHEMA_VERSION
        # ディスク上にも保存される
        on_disk = json.loads(config_file.read_text(encoding="utf-8"))
        assert on_disk["__global__"]["config_version"] == CONFIG_SCHEMA_VERSION
        # 既存データは保持される
        assert on_disk["__global__"]["snippets"][0]["command"] == "ls"

    def test_current_version_is_not_rewritten(self, isolate_fs):
        from api.common import CONFIG_SCHEMA_VERSION
        from api.config import load_all_config
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(
            json.dumps({"__global__": {"config_version": CONFIG_SCHEMA_VERSION}}),
            encoding="utf-8",
        )
        mtime_before = config_file.stat().st_mtime_ns
        load_all_config()
        # 同バージョンなら再書き込みしない（.bak も作られない）
        assert config_file.stat().st_mtime_ns == mtime_before
        assert not config_file.with_suffix(".bak").exists()

    def test_newer_version_is_preserved_not_downgraded(self, isolate_fs):
        from api.common import CONFIG_SCHEMA_VERSION
        from api.config import load_all_config
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        future = CONFIG_SCHEMA_VERSION + 99
        config_file.write_text(
            json.dumps({"__global__": {"config_version": future, "snippets": []}}),
            encoding="utf-8",
        )
        loaded = load_all_config()
        # 新しいバージョンは勝手に下げない（best-effort 互換）
        assert loaded["__global__"]["config_version"] == future
        on_disk = json.loads(config_file.read_text(encoding="utf-8"))
        assert on_disk["__global__"]["config_version"] == future

    def test_migrate_radial_renames_to_circle_keypad(self):
        from api.config_migrations import _migrate_radial_to_circle_keypad
        cfg = {"__global__": {"radial": {"enabled": False, "keys": []}, "snippets": []}}
        out = _migrate_radial_to_circle_keypad(cfg)
        assert "radial" not in out["__global__"]
        assert out["__global__"]["circle_keypad"]["enabled"] is False
        assert out["__global__"]["snippets"] == []
        # 元 dict は破壊しない
        assert "radial" in cfg["__global__"]

    def test_migrate_radial_keeps_existing_circle_keypad(self):
        from api.config_migrations import _migrate_radial_to_circle_keypad
        cfg = {"__global__": {
            "radial": {"enabled": False},
            "circle_keypad": {"enabled": True},
        }}
        out = _migrate_radial_to_circle_keypad(cfg)
        # 新キーに設定済みならそちらを正とし、旧キーは破棄する
        assert out["__global__"]["circle_keypad"]["enabled"] is True
        assert "radial" not in out["__global__"]

    def test_migrate_radial_noop_without_radial(self):
        from api.config_migrations import _migrate_radial_to_circle_keypad
        cfg = {"__global__": {"snippets": []}}
        assert _migrate_radial_to_circle_keypad(cfg) is cfg

    def test_migrate_radial_drops_invalid_legacy_value(self):
        from api.config_migrations import _migrate_radial_to_circle_keypad
        cfg = {"__global__": {"radial": "broken"}}
        out = _migrate_radial_to_circle_keypad(cfg)
        assert "radial" not in out["__global__"]
        assert "circle_keypad" not in out["__global__"]

    def test_migrate_pinned_jobs_renames_to_recent_jobs(self):
        from api.config_migrations import _migrate_pinned_jobs_to_recent_jobs
        cfg = {"__global__": {
            "pinned_jobs": [{"key": "ws1:build", "workspace": "ws1"}],
            "snippets": [],
        }}
        out = _migrate_pinned_jobs_to_recent_jobs(cfg)
        assert "pinned_jobs" not in out["__global__"]
        assert out["__global__"]["recent_jobs"] == [
            {"key": "ws1:build", "workspace": "ws1", "pinned": True},
        ]
        assert out["__global__"]["snippets"] == []
        # 元 dict は破壊しない
        assert "pinned_jobs" in cfg["__global__"]

    def test_migrate_pinned_jobs_overwrites_legacy_recent_jobs_key(self):
        from api.config_migrations import _migrate_pinned_jobs_to_recent_jobs
        cfg = {"__global__": {
            "pinned_jobs": [{"key": "ws1:build", "workspace": "ws1"}],
            "recent_jobs": [{"key": "stale:leftover"}],
        }}
        out = _migrate_pinned_jobs_to_recent_jobs(cfg)
        assert out["__global__"]["recent_jobs"] == [
            {"key": "ws1:build", "workspace": "ws1", "pinned": True},
        ]

    def test_migrate_pinned_jobs_noop_without_pinned_jobs(self):
        from api.config_migrations import _migrate_pinned_jobs_to_recent_jobs
        cfg = {"__global__": {"snippets": []}}
        assert _migrate_pinned_jobs_to_recent_jobs(cfg) is cfg

    def test_migrate_pinned_jobs_drops_invalid_items(self):
        from api.config_migrations import _migrate_pinned_jobs_to_recent_jobs
        cfg = {"__global__": {"pinned_jobs": ["broken", {"workspace": "no-key"}, None]}}
        out = _migrate_pinned_jobs_to_recent_jobs(cfg)
        assert out["__global__"]["recent_jobs"] == []

    def test_migrate_applies_registered_steps(self):
        from api import config_migrations as config_mod
        from api.config_migrations import _migrate_config_version

        calls = []

        def fake_step(cfg):
            calls.append(dict(cfg))
            new = dict(cfg)
            new["migrated_marker"] = True
            return new

        original = config_mod._CONFIG_MIGRATIONS
        original_version = config_mod.CONFIG_SCHEMA_VERSION
        try:
            config_mod.CONFIG_SCHEMA_VERSION = 1
            config_mod._CONFIG_MIGRATIONS = {0: fake_step}
            out, did = _migrate_config_version({"ws_a": {"name": "a"}})
            assert did is True
            assert out["migrated_marker"] is True
            assert out["__global__"]["config_version"] == 1
            assert len(calls) == 1
        finally:
            config_mod._CONFIG_MIGRATIONS = original
            config_mod.CONFIG_SCHEMA_VERSION = original_version


class TestConfigHealth:
    def test_health_no_config_file(self, isolate_fs):
        from api.config import check_config_health
        result = check_config_health()
        assert result["ok"] is True
        assert result["source"] == "empty"
        assert result["errors"] == []

    def test_health_valid_config(self, isolate_fs):
        from api.config import save_all_config, check_config_health
        save_all_config({"ws": {"icon": "", "icon_color": "", "hidden": False, "jobs": {}}})
        result = check_config_health()
        assert result["ok"] is True
        assert result["source"] == "config.json"
        assert result["errors"] == []

    def test_health_invalid_json(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text("{invalid json", encoding="utf-8")

        from api.config import check_config_health
        result = check_config_health()
        assert result["ok"] is False
        assert result["source"] == "broken"
        assert len(result["errors"]) == 1
        assert result["errors"][0]["key"] == "__root__"

    def test_health_invalid_json_with_bak(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        bak_file = config_file.with_suffix(".bak")
        bak_file.write_text(json.dumps({"ws": {"icon": "", "icon_color": "", "hidden": False, "jobs": {}}}), encoding="utf-8")
        config_file.write_text("{invalid json", encoding="utf-8")

        from api.config import check_config_health
        result = check_config_health()
        assert result["ok"] is False
        assert result["source"] == "config.bak"
        assert result["errors"] == []

    def test_health_validation_errors(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        raw = {
            "valid-ws": {"icon": "", "icon_color": "", "hidden": False, "jobs": {}},
            "bad-ws": {"jobs": {"j": {"no_command": True}}},
        }
        config_file.write_text(json.dumps(raw), encoding="utf-8")

        from api.config import check_config_health
        result = check_config_health()
        assert result["ok"] is False
        assert result["source"] == "config.json"
        assert any(e["key"] == "bad-ws" for e in result["errors"])

    def test_health_endpoint(self, client, isolate_fs):
        from conftest import AUTH
        res = client.get("/settings/config-health", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "ok" in data
        assert "errors" in data
        assert "source" in data

    def test_health_reports_newer_config_version(self, isolate_fs):
        from api.common import CONFIG_SCHEMA_VERSION
        from api.config import check_config_health
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        future = CONFIG_SCHEMA_VERSION + 5
        config_file.write_text(
            json.dumps({"__global__": {"config_version": future}}),
            encoding="utf-8",
        )
        result = check_config_health()
        assert result["ok"] is False
        assert result["config_version"] == future
        assert result["supported_config_version"] == CONFIG_SCHEMA_VERSION
        assert any(e["key"] == "__version__" for e in result["errors"])


class TestMatchWorkspaceByPath:
    def _write_entries(self, isolate_fs, entries):
        config_file = isolate_fs["config_file"]
        config_file.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")

    def test_longest_prefix_wins(self, isolate_fs):
        from api.config import match_workspace_by_path
        self._write_entries(isolate_fs, {
            "ws_a": {"name": "parent", "path": "/home/u/proj"},
            "ws_b": {"name": "child", "path": "/home/u/proj/sub"},
        })
        assert match_workspace_by_path("/home/u/proj/sub/deep") == "child"
        assert match_workspace_by_path("/home/u/proj/other") == "parent"
        assert match_workspace_by_path("/home/u/proj") == "parent"

    def test_partial_component_does_not_match(self, isolate_fs):
        from api.config import match_workspace_by_path
        self._write_entries(isolate_fs, {"ws_a": {"name": "proj", "path": "/home/u/proj"}})
        assert match_workspace_by_path("/home/u/proj2") is None

    def test_none_and_unregistered(self, isolate_fs):
        from api.config import match_workspace_by_path
        self._write_entries(isolate_fs, {"ws_a": {"name": "proj", "path": "/home/u/proj"}})
        assert match_workspace_by_path(None) is None
        assert match_workspace_by_path("") is None
        assert match_workspace_by_path("/tmp/elsewhere") is None

    def test_falls_back_to_key_without_name(self, isolate_fs):
        from api.config import match_workspace_by_path
        self._write_entries(isolate_fs, {"ws_x": {"path": "/home/u/p"}})
        assert match_workspace_by_path("/home/u/p") == "ws_x"

    def test_matches_home_relative_registered_path(self, isolate_fs, monkeypatch):
        # config.jsonにはホーム配下のパスが "~/..." 形式(collapse_user_path)で
        # 保存されるため、絶対パス(tmux/lsof等から得るcwd)との照合には展開が
        # 必要（回帰: ホーム配下のワークスペースが一切マッチしなかった不具合）。
        from api.config import match_workspace_by_path
        fake_home = isolate_fs["work"]
        monkeypatch.setenv("HOME", str(fake_home))
        self._write_entries(isolate_fs, {"ws_a": {"name": "proj", "path": "~/proj"}})
        assert match_workspace_by_path(str(fake_home / "proj")) == "proj"
        assert match_workspace_by_path(str(fake_home / "proj" / "sub")) == "proj"
        assert match_workspace_by_path(str(fake_home / "other")) is None
