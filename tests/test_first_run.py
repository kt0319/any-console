"""初回起動・初期設定の動作確認テスト

新規ユーザーが最初に踏む経路が壊れていないことを確認する。
既存の test_api.py / test_scenarios.py とは重複しないように、
「何もない状態から始めて基本操作が通る」観点に絞る。
"""

import pytest

from conftest import AUTH


class TestFreshStart:
    """config.json が存在しない初回起動状態"""

    def test_workspace_list_is_empty(self, client):
        res = client.get("/workspaces", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == []

    def test_global_jobs_is_empty(self, client):
        res = client.get("/global/jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_recent_jobs_is_empty(self, client):
        res = client.get("/recent-jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["jobs"] == []

    def test_snippets_is_empty(self, client):
        res = client.get("/snippets", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["snippets"] == []

    def test_auth_check_works(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200

    def test_no_token_returns_401(self, client):
        res = client.get("/auth/check")
        assert res.status_code == 401


class TestSettingsDefaults:
    """設定エンドポイントが初期値を正しく返す"""

    def test_workspace_root_returns_default(self, client, isolate_fs):
        res = client.get("/settings/workspace-root", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "workspace_root" in data
        assert "effective" in data
        # 未設定なら workspace_root は空文字
        assert data["workspace_root"] == ""
        # effective は空でない（デフォルトパスが返る）
        assert data["effective"] != ""

    def test_editor_settings_returns_default(self, client):
        res = client.get("/settings/editor", headers=AUTH)
        assert res.status_code == 200
        assert "url_template" in res.json()
        assert res.json()["url_template"] == ""

    def test_export_is_empty_on_fresh_start(self, client):
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}


class TestFirstWorkspace:
    """ワークスペースを初めて追加する操作"""

    def test_add_first_workspace(self, client, isolate_fs):
        ws_dir = isolate_fs["work"] / "my-project"
        ws_dir.mkdir()

        res = client.post("/workspaces", headers=AUTH, json={"path": str(ws_dir)})
        assert res.status_code == 200
        assert res.json()["name"] == "my-project"

        # 一覧に現れる
        res = client.get("/workspaces", headers=AUTH)
        names = [w["name"] for w in res.json()]
        assert "my-project" in names

    def test_nonexistent_path_is_rejected(self, client, isolate_fs):
        res = client.post("/workspaces", headers=AUTH, json={
            "path": str(isolate_fs["work"] / "does-not-exist"),
        })
        assert res.status_code == 400

    def test_workspace_jobs_empty_after_add(self, client, workspace):
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        # グローバルジョブがなければ空
        assert res.json() == {}

    def test_workspace_config_can_be_updated(self, client, workspace):
        res = client.put("/workspaces/test-ws/config", headers=AUTH, json={
            "icon": "mdi-console",
            "icon_color": "#42a5f5",
            "hidden": False,
        })
        assert res.status_code == 200

        # 一覧に反映される
        res = client.get("/workspaces", headers=AUTH)
        ws = next(w for w in res.json() if w["name"] == "test-ws")
        assert ws["icon"] == "mdi-console"


class TestFirstJob:
    """ジョブを初めて作成・実行する操作"""

    def test_create_job_with_icon(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "My First Job",
            "command": "echo hello",
            "icon": "mdi-play-circle-outline",
            "icon_color": "#42a5f5",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        jobs = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        assert jobs[job_name]["icon"] == "mdi-play-circle-outline"
        assert jobs[job_name]["icon_color"] == "#42a5f5"
        assert jobs[job_name]["label"] == "My First Job"

    def test_create_job_command_is_required(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "No Command",
            "command": "",
        })
        assert res.status_code == 400

    def test_execute_first_job(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Hello",
            "command": "echo first-run-ok",
            "confirm": False,
        })
        job_name = res.json()["name"]

        res = client.post("/run", headers=AUTH, json={
            "job": job_name,
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0
        assert "first-run-ok" in res.json()["stdout"]

    def test_recent_jobs_recorded_after_execution(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Tracked Job",
            "command": "echo tracked",
            "icon": "mdi-play-circle-outline",
            "confirm": False,
        })
        job_name = res.json()["name"]

        # recent に記録する
        client.post("/recent-jobs", headers=AUTH, json={
            "key": f"test-ws:{job_name}",
            "workspace": "test-ws",
            "wsIcon": "mdi-console",
            "wsIconColor": "",
            "jobName": job_name,
            "jobLabel": "Tracked Job",
            "jobIcon": "mdi-play-circle-outline",
            "jobIconColor": "",
            "jobCommand": "echo tracked",
            "jobConfirm": False,
            "jobHiddenTab": False,
        })

        res = client.get("/recent-jobs", headers=AUTH)
        jobs = res.json()["jobs"]
        assert len(jobs) == 1
        assert jobs[0]["jobLabel"] == "Tracked Job"
        assert jobs[0]["jobIcon"] == "mdi-play-circle-outline"


class TestWorkspaceRoot:
    """ワークスペースルートの変更が反映される"""

    def test_set_workspace_root(self, client, isolate_fs):
        custom = isolate_fs["work"] / "custom-root"
        custom.mkdir()

        res = client.put("/settings/workspace-root", headers=AUTH, json={
            "workspace_root": str(custom),
        })
        assert res.status_code == 200

        # 読み返しても保存された値が一致する
        res = client.get("/settings/workspace-root", headers=AUTH)
        assert res.json()["workspace_root"] == str(custom)

    def test_invalid_workspace_root_is_rejected(self, client):
        res = client.put("/settings/workspace-root", headers=AUTH, json={
            "workspace_root": "/path/that/does/not/exist",
        })
        assert res.status_code == 400
