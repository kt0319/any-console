import json

import pytest


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
        assert loaded["my-ws"]["icon"] == "mdi-star"
        assert loaded["my-ws"]["icon_color"] == "#ff0000"

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

    def test_load_corrupted_json_raises(self, isolate_fs):
        config_file = isolate_fs["config_file"]
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text("{invalid json", encoding="utf-8")

        from api.config import load_all_config
        with pytest.raises(json.JSONDecodeError):
            load_all_config()

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
        assert "valid-ws" in loaded
        assert "bad-ws" not in loaded

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
        assert loaded["ws1"]["icon"] == "updated"
        assert loaded["ws2"]["icon"] == "b"


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
