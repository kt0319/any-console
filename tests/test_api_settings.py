import json

from conftest import AUTH, find_ws_entry


# --- 認証設定 ---


class TestAuthSettings:
    def setup_method(self):
        import api.auth as _auth
        self._original_token = _auth.ANY_CONSOLE_TOKEN
        self._original_file = _auth._AUTH_FILE.read_text() if _auth._AUTH_FILE.exists() else None

    def teardown_method(self):
        import api.auth as _auth
        _auth.ANY_CONSOLE_TOKEN = self._original_token
        if self._original_file is not None:
            _auth._AUTH_FILE.write_text(self._original_file)
        elif _auth._AUTH_FILE.exists():
            _auth._AUTH_FILE.unlink()

    def test_get_auth_settings(self, client):
        res = client.get("/settings/auth", headers=AUTH)
        assert res.status_code == 200
        assert "auth_required" in res.json()

    def test_put_disable_auth(self, client):
        res = client.put("/settings/auth", headers=AUTH, json={"enabled": False, "token": ""})
        assert res.status_code == 200
        assert res.json()["auth_required"] is False

    def test_put_enable_auth_requires_token(self, client):
        res = client.put("/settings/auth", headers=AUTH, json={"enabled": True, "token": ""})
        assert res.status_code == 400

    def test_put_enable_auth_with_token(self, client):
        res = client.put("/settings/auth", headers=AUTH, json={"enabled": True, "token": "newtoken"})
        assert res.status_code == 200
        assert res.json()["auth_required"] is True


# --- 設定エクスポート/インポート ---


class TestSettings:
    def test_export_empty(self, client):
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_export_includes_all_workspaces(self, client, workspace, isolate_fs):
        config = {
            "ws_aaaaaaaaaaaa": {"name": "test-ws", "icon": "star"},
            "ws_bbbbbbbbbbbb": {"name": "nonexistent", "icon": "x"},
        }
        isolate_fs["config_file"].write_text(json.dumps(config))
        res = client.get("/settings/export", headers=AUTH)
        data = res.json()
        names = {v.get("name") for v in data.values() if isinstance(v, dict)}
        assert "test-ws" in names
        assert "nonexistent" in names

    def test_import_settings(self, client, workspace, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"icon": "rocket"}})
        assert res.status_code == 200
        config = json.loads(isolate_fs["config_file"].read_text())
        entry = find_ws_entry(config, "test-ws")
        assert entry is not None
        assert entry["icon"] == "rocket"

    def test_import_invalid_json(self, client):
        res = client.post(
            "/settings/import",
            headers={**AUTH, "Content-Type": "application/json"},
            content="not json",
        )
        assert res.status_code == 400

    def test_import_non_dict(self, client):
        res = client.post("/settings/import", headers=AUTH, json=[1, 2, 3])
        assert res.status_code == 400

    def test_import_ignores_nonexistent_workspace(self, client, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"ghost": {"icon": "x"}})
        assert res.status_code == 200
        if isolate_fs["config_file"].exists():
            config = json.loads(isolate_fs["config_file"].read_text())
            assert "ghost" not in config

    def test_import_rejects_invalid_workspace_schema(self, client, workspace):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"jobs": {"bad": {}}}})
        assert res.status_code == 400

    def test_export_skips_invalid_workspace_config(self, client, workspace, isolate_fs):
        isolate_fs["config_file"].write_text(json.dumps({"test-ws": {"jobs": {"bad": {}}}}))
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}


class TestConfigHealth:
    def test_get_config_health(self, client):
        res = client.get("/settings/config-health", headers=AUTH)
        assert res.status_code == 200
        assert "ok" in res.json() or isinstance(res.json(), dict)

    def test_import_content_length_too_large(self, client):
        res = client.post(
            "/settings/import",
            headers={**AUTH, "Content-Type": "application/json", "Content-Length": str(2 * 1024 * 1024)},
            content=json.dumps({}),
        )
        assert res.status_code == 413

    def test_import_global_config_key(self, client, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"__global__": {"editor": {}}})
        assert res.status_code == 200

    def test_import_non_dict_ws_config_is_skipped(self, client):
        res = client.post("/settings/import", headers=AUTH, json={"some-ws": "not-a-dict"})
        assert res.status_code == 200

    def test_import_workspace_path_not_dir_is_skipped(self, client, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"icon": "star"}})
        assert res.status_code == 200


class TestEditorSettings:
    def test_get_default(self, client):
        res = client.get("/settings/editor", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"url_template": ""}

    def test_put_and_get(self, client):
        res = client.put("/settings/editor", headers=AUTH, json={
            "url_template": "vscode://file/{path}:{line}",
        })
        assert res.status_code == 200
        assert res.json()["url_template"] == "vscode://file/{path}:{line}"

        res = client.get("/settings/editor", headers=AUTH)
        assert res.json()["url_template"] == "vscode://file/{path}:{line}"

    def test_put_trims_whitespace(self, client):
        res = client.put("/settings/editor", headers=AUTH, json={
            "url_template": "  vscode://file/{path}  ",
        })
        assert res.json()["url_template"] == "vscode://file/{path}"

    def test_put_empty_string(self, client):
        client.put("/settings/editor", headers=AUTH, json={
            "url_template": "vscode://file/{path}",
        })
        res = client.put("/settings/editor", headers=AUTH, json={
            "url_template": "",
        })
        assert res.status_code == 200
        assert res.json()["url_template"] == ""

        res = client.get("/settings/editor", headers=AUTH)
        assert res.json()["url_template"] == ""

    def test_get_falls_back_when_config_not_dict(self, client, isolate_fs):
        import json as _json
        isolate_fs["config_file"].write_text(_json.dumps({"__global__": {"editor": "broken"}}))
        res = client.get("/settings/editor", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["url_template"] == ""


class TestNotificationSettings:
    def test_get_default(self, client):
        res = client.get("/settings/notifications", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"phrase_notify_grace_sec": 20}

    def test_put_and_get(self, client):
        res = client.put("/settings/notifications", headers=AUTH, json={
            "phrase_notify_grace_sec": 30,
        })
        assert res.status_code == 200
        assert res.json()["phrase_notify_grace_sec"] == 30

        res = client.get("/settings/notifications", headers=AUTH)
        assert res.json()["phrase_notify_grace_sec"] == 30

    def test_put_rejects_negative(self, client):
        res = client.put("/settings/notifications", headers=AUTH, json={
            "phrase_notify_grace_sec": -1,
        })
        assert res.status_code == 422

    def test_put_rejects_too_large(self, client):
        res = client.put("/settings/notifications", headers=AUTH, json={
            "phrase_notify_grace_sec": 601,
        })
        assert res.status_code == 422

    def test_get_falls_back_when_config_not_dict(self, client, isolate_fs):
        import json as _json
        isolate_fs["config_file"].write_text(_json.dumps({"__global__": {"notifications": "broken"}}))
        res = client.get("/settings/notifications", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["phrase_notify_grace_sec"] == 20


class TestCircleKeypadSettings:
    def test_get_default(self, client):
        res = client.get("/settings/circle-keypad", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["keys"] == []
        assert data["specials"] == []
        assert data["enabled"] is True

    def test_get_enabled_false(self, client, isolate_fs):
        import json as _json
        isolate_fs["config_file"].write_text(_json.dumps({"__global__": {"circle_keypad": {"enabled": False, "keys": [], "specials": []}}}))
        res = client.get("/settings/circle-keypad", headers=AUTH)
        assert res.json()["enabled"] is False

    def test_get_migrates_from_legacy_radial_key(self, client, isolate_fs):
        # 旧名（radial）で保存されていた既存ユーザーの設定は、config 読み込み時の
        # マイグレーション（v1 -> v2）で circle_keypad へ改名される。
        import json as _json
        isolate_fs["config_file"].write_text(_json.dumps({"__global__": {"radial": {"enabled": False, "keys": [], "specials": []}}}))
        res = client.get("/settings/circle-keypad", headers=AUTH)
        assert res.json()["enabled"] is False

        # 移行後は新キーへ書き戻され、旧キーは残らない
        config = _json.loads(isolate_fs["config_file"].read_text())
        assert config["__global__"]["circle_keypad"]["enabled"] is False
        assert "radial" not in config["__global__"]

    def test_put_and_get(self, client):
        keys = [{"key": str(i), "ctrl": False, "shift": False, "label": f"k{i}"} for i in range(8)]
        specials = [{"label": f"s{i}", "action": f"action:{i}", "payload": None} for i in range(4)]
        res = client.put("/settings/circle-keypad", headers=AUTH, json={"keys": keys, "specials": specials, "enabled": True})
        assert res.status_code == 200

        res = client.get("/settings/circle-keypad", headers=AUTH)
        assert len(res.json()["keys"]) == 8
        assert res.json()["enabled"] is True

    def test_put_wrong_key_count(self, client):
        res = client.put("/settings/circle-keypad", headers=AUTH, json={"keys": [{"key": "a", "ctrl": False, "shift": False, "label": "x"}], "specials": [], "enabled": True})
        assert res.status_code == 400

    def test_put_wrong_special_count(self, client):
        keys = [{"key": str(i), "ctrl": False, "shift": False, "label": f"k{i}"} for i in range(8)]
        specials = [{"label": "x", "action": "y", "payload": None}]
        res = client.put("/settings/circle-keypad", headers=AUTH, json={"keys": keys, "specials": specials, "enabled": True})
        assert res.status_code == 400

    def test_put_disabled(self, client):
        res = client.put("/settings/circle-keypad", headers=AUTH, json={"keys": [], "specials": [], "enabled": False})
        assert res.status_code == 200
        res = client.get("/settings/circle-keypad", headers=AUTH)
        assert res.json()["enabled"] is False


class TestLayoutSettings:
    def test_get_default(self, client):
        res = client.get("/settings/layout", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["split"] is None

    def test_put_and_get(self, client):
        res = client.put("/settings/layout", headers=AUTH, json={
            "session_ids": ["sess-a", "sess-b"],
            "layout": "horizontal",
            "active_pane_index": 0,
        })
        assert res.status_code == 200

        res = client.get("/settings/layout", headers=AUTH)
        split = res.json()["split"]
        assert split is not None
        assert split["session_ids"] == ["sess-a", "sess-b"]
        assert split["layout"] == "horizontal"
        assert split["active_pane_index"] == 0

    def test_put_with_null_session_ids(self, client):
        res = client.put("/settings/layout", headers=AUTH, json={
            "session_ids": ["sess-a", None, "sess-b"],
            "layout": "grid",
            "active_pane_index": 1,
        })
        assert res.status_code == 200
        split = client.get("/settings/layout", headers=AUTH).json()["split"]
        assert split["session_ids"] == ["sess-a", None, "sess-b"]
        assert split["layout"] == "grid"

    def test_put_invalid_layout(self, client):
        res = client.put("/settings/layout", headers=AUTH, json={
            "session_ids": ["sess-a"],
            "layout": "invalid",
            "active_pane_index": 0,
        })
        assert res.status_code == 400

    def test_delete(self, client):
        client.put("/settings/layout", headers=AUTH, json={
            "session_ids": ["sess-a"],
            "layout": "horizontal",
            "active_pane_index": 0,
        })
        res = client.delete("/settings/layout", headers=AUTH)
        assert res.status_code == 200
        split = client.get("/settings/layout", headers=AUTH).json()["split"]
        assert split is None



class TestSnippets:
    def test_get_empty(self, client):
        res = client.get("/snippets", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"snippets": []}

    def test_put_and_get(self, client):
        res = client.put("/snippets", headers=AUTH, json={
            "snippets": [
                {"label": "Hello", "command": "echo hello"},
                {"label": "World", "command": "echo world"},
            ],
        })
        assert res.status_code == 200
        snippets = res.json()["snippets"]
        assert len(snippets) == 2
        assert snippets[0]["label"] == "Hello"
        assert snippets[0]["command"] == "echo hello"

        res = client.get("/snippets", headers=AUTH)
        assert len(res.json()["snippets"]) == 2

    def test_auto_label_from_command(self, client):
        res = client.put("/snippets", headers=AUTH, json={
            "snippets": [{"label": "", "command": "echo hello world"}],
        })
        snippets = res.json()["snippets"]
        assert snippets[0]["label"] == "echo hello world"

    def test_auto_label_truncates_long_command(self, client):
        long_cmd = "echo " + "x" * 30
        res = client.put("/snippets", headers=AUTH, json={
            "snippets": [{"label": "", "command": long_cmd}],
        })
        snippets = res.json()["snippets"]
        assert snippets[0]["label"].endswith("...")
        assert len(snippets[0]["label"]) <= 23

    def test_empty_command_is_skipped(self, client):
        res = client.put("/snippets", headers=AUTH, json={
            "snippets": [
                {"label": "keep", "command": "echo ok"},
                {"label": "skip", "command": "  "},
            ],
        })
        assert len(res.json()["snippets"]) == 1

    def test_put_then_get_roundtrip(self, client):
        client.put("/snippets", headers=AUTH, json={
            "snippets": [
                {"label": "A", "command": "echo a"},
                {"label": "B", "command": "echo b"},
            ],
        })
        res = client.get("/snippets", headers=AUTH)
        snippets = res.json()["snippets"]
        assert len(snippets) == 2
        assert snippets[0]["label"] == "A"
        assert snippets[1]["label"] == "B"


class TestDefaultLabel:
    """settings._default_label のユニットテスト"""

    def setup_method(self):
        from api.routers.settings import _default_label
        self._fn = _default_label

    def test_short_command_no_ellipsis(self):
        assert self._fn("echo hi") == "echo hi"

    def test_exactly_20_chars_no_ellipsis(self):
        cmd = "a" * 20
        assert self._fn(cmd) == cmd

    def test_21_chars_truncated_with_ellipsis(self):
        cmd = "a" * 21
        assert self._fn(cmd) == "a" * 20 + "..."

    def test_long_command_truncated(self):
        cmd = "x" * 100
        result = self._fn(cmd)
        assert result == "x" * 20 + "..."
        assert len(result) == 23

    def test_empty_string(self):
        assert self._fn("") == ""
