import json

from conftest import AUTH, find_ws_entry


# --- 設定エクスポート/インポート ---


class TestSettings:
    def test_export_empty(self, client):
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_export_includes_all_workspaces(self, client, workspace, isolate_fs):
        config = {"test-ws": {"icon": "star"}, "nonexistent": {"icon": "x"}}
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
