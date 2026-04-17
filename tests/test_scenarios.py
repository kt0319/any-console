"""シナリオテスト: 複合操作の一連の流れを検証する"""

import json
import subprocess

import pytest

from conftest import AUTH


class TestWorkspaceJobScenario:
    """ワークスペース作成 → ジョブ作成 → 実行 → 削除の一連フロー"""

    def test_full_lifecycle(self, client, isolate_fs):
        work = isolate_fs["work"]
        ws_dir = work / "scenario-ws"
        ws_dir.mkdir()

        # ワークスペース追加
        res = client.post("/workspaces", headers=AUTH, json={"path": str(ws_dir)})
        assert res.status_code == 200
        ws_name = res.json()["name"]
        assert ws_name == "scenario-ws"

        # ジョブ作成
        res = client.post(f"/workspaces/{ws_name}/jobs", headers=AUTH, json={
            "label": "Say Hello",
            "command": "echo hello-scenario",
            "icon": "mdi-play",
            "icon_color": "#00ff00",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        # ジョブ一覧に含まれる
        res = client.get(f"/workspaces/{ws_name}/jobs", headers=AUTH)
        assert res.status_code == 200
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["label"] == "Say Hello"
        assert jobs[job_name]["icon"] == "mdi-play"

        # ジョブ実行
        res = client.post("/run", headers=AUTH, json={
            "job": job_name,
            "workspace": ws_name,
        })
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0
        assert "hello-scenario" in res.json()["stdout"]

        # ジョブ削除
        res = client.delete(f"/workspaces/{ws_name}/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200

        # 削除後は一覧に含まれない
        res = client.get(f"/workspaces/{ws_name}/jobs", headers=AUTH)
        assert job_name not in res.json()

        # ワークスペース削除
        res = client.delete(f"/workspaces/{ws_name}", headers=AUTH)
        assert res.status_code == 200

    def test_job_update_then_execute(self, client, workspace):
        # ジョブ作成
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Version 1",
            "command": "echo v1",
        })
        job_name = res.json()["name"]

        # 実行 → v1
        res = client.post("/run", headers=AUTH, json={"job": job_name, "workspace": "test-ws"})
        assert "v1" in res.json()["stdout"]

        # 更新
        client.put(f"/workspaces/test-ws/jobs/{job_name}", headers=AUTH, json={
            "label": "Version 2",
            "command": "echo v2",
        })

        # 再実行 → v2
        res = client.post("/run", headers=AUTH, json={"job": job_name, "workspace": "test-ws"})
        assert "v2" in res.json()["stdout"]


class TestGlobalJobScenario:
    """グローバルジョブの作成 → ワークスペースから参照 → 実行"""

    def test_global_job_visible_in_workspace(self, client, workspace):
        # グローバルジョブ作成
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "Global Echo",
            "command": "echo global-test",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        # ワークスペースのジョブ一覧に表示される
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["global"] is True

        # ワークスペースから実行可能
        res = client.post("/run", headers=AUTH, json={
            "job": job_name,
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        assert "global-test" in res.json()["stdout"]

        # グローバルジョブ削除
        res = client.delete(f"/global/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200

        # ワークスペースから消える
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert job_name not in res.json()

    def test_workspace_job_overrides_global(self, client, workspace):
        # グローバルジョブ作成
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "Override Me",
            "command": "echo from-global",
        })
        global_job_name = res.json()["name"]

        # 同名ジョブをワークスペースに作成（config.jsonで直接設定）
        config = json.loads(
            (workspace.parent / ".." / "data" / "config.json").resolve().read_text(encoding="utf-8")
        )
        config.setdefault("test-ws", {}).setdefault("jobs", {})[global_job_name] = {
            "command": "echo from-workspace",
            "label": "Overridden",
        }
        (workspace.parent / ".." / "data" / "config.json").resolve().write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 実行するとワークスペース版が優先
        res = client.post("/run", headers=AUTH, json={
            "job": global_job_name,
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        assert "from-workspace" in res.json()["stdout"]

    def test_global_job_full_crud(self, client):
        # 作成
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "CRUD Test",
            "command": "echo crud",
            "icon": "mdi-cog",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        # 読み取り
        res = client.get("/global/jobs", headers=AUTH)
        assert job_name in res.json()
        assert res.json()[job_name]["icon"] == "mdi-cog"

        # 更新
        res = client.put(f"/global/jobs/{job_name}", headers=AUTH, json={
            "label": "CRUD Updated",
            "command": "echo updated",
            "icon": "mdi-star",
        })
        assert res.status_code == 200
        res = client.get("/global/jobs", headers=AUTH)
        assert res.json()[job_name]["command"] == "echo updated"
        assert res.json()[job_name]["icon"] == "mdi-star"

        # 削除
        res = client.delete(f"/global/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200
        res = client.get("/global/jobs", headers=AUTH)
        assert job_name not in res.json()


class TestTerminalSessionScenario:
    """ターミナルセッション作成 → 一覧確認 → 削除"""

    def test_create_list_delete(self, client, workspace):
        # セッション作成
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "job_name": "my_job",
            "job_label": "My Job",
        })
        assert res.status_code == 200
        session_id = res.json()["session_id"]

        # 一覧に含まれる
        res = client.get("/terminal/sessions", headers=AUTH)
        sessions = res.json()
        matched = [s for s in sessions if s["session_id"] == session_id]
        assert len(matched) == 1
        assert matched[0]["workspace"] == "test-ws"
        assert matched[0]["job_name"] == "my_job"

        # 削除
        res = client.delete(f"/terminal/sessions/{session_id}", headers=AUTH)
        assert res.status_code == 200

        # 削除後は一覧から消える
        res = client.get("/terminal/sessions", headers=AUTH)
        sessions = res.json()
        assert all(s["session_id"] != session_id for s in sessions)

    def test_multiple_sessions(self, client, workspace):
        session_ids = []
        for i in range(3):
            res = client.post("/run", headers=AUTH, json={
                "job": "terminal",
                "workspace": "test-ws",
            })
            assert res.status_code == 200
            session_ids.append(res.json()["session_id"])

        res = client.get("/terminal/sessions", headers=AUTH)
        listed_ids = {s["session_id"] for s in res.json()}
        for sid in session_ids:
            assert sid in listed_ids

        # 個別削除
        for sid in session_ids:
            res = client.delete(f"/terminal/sessions/{sid}", headers=AUTH)
            assert res.status_code == 200


class TestMultiWorkspaceScenario:
    """複数ワークスペースを跨いだジョブ管理"""

    def test_jobs_isolated_per_workspace(self, client, isolate_fs):
        work = isolate_fs["work"]
        for name in ("ws-alpha", "ws-beta"):
            (work / name).mkdir()
            client.post("/workspaces", headers=AUTH, json={"path": str(work / name)})

        # 各ワークスペースにジョブ作成
        res_a = client.post("/workspaces/ws-alpha/jobs", headers=AUTH, json={
            "label": "Alpha Job",
            "command": "echo alpha",
        })
        job_alpha = res_a.json()["name"]

        res_b = client.post("/workspaces/ws-beta/jobs", headers=AUTH, json={
            "label": "Beta Job",
            "command": "echo beta",
        })
        job_beta = res_b.json()["name"]

        # alpha のジョブは beta に見えない
        alpha_jobs = client.get("/workspaces/ws-alpha/jobs", headers=AUTH).json()
        beta_jobs = client.get("/workspaces/ws-beta/jobs", headers=AUTH).json()
        assert job_alpha in alpha_jobs
        assert job_alpha not in beta_jobs
        assert job_beta in beta_jobs
        assert job_beta not in alpha_jobs

        # /jobs/workspaces で全体一覧に両方含まれる
        all_jobs = client.get("/jobs/workspaces", headers=AUTH).json()
        assert job_alpha in all_jobs["ws-alpha"]
        assert job_beta in all_jobs["ws-beta"]

    def test_global_job_appears_in_all_workspaces(self, client, isolate_fs):
        work = isolate_fs["work"]
        for name in ("ws-one", "ws-two"):
            (work / name).mkdir()
            client.post("/workspaces", headers=AUTH, json={"path": str(work / name)})

        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "Shared Job",
            "command": "echo shared",
        })
        job_name = res.json()["name"]

        for ws_name in ("ws-one", "ws-two"):
            jobs = client.get(f"/workspaces/{ws_name}/jobs", headers=AUTH).json()
            assert job_name in jobs
            assert jobs[job_name]["global"] is True


class TestConfigImportExportScenario:
    """設定エクスポート → 変更 → インポートで復元"""

    def test_export_modify_reimport(self, client, workspace):
        # ジョブ作成
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Exportable",
            "command": "echo export",
        })

        # エクスポート
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        exported = res.json()
        assert "test-ws" in exported

        # ジョブ追加
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Extra",
            "command": "echo extra",
        })
        current = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        assert len(current) == 2

        # エクスポートした設定を再インポート（1ジョブに戻る）
        from api.routers.jobs import _workspace_jobs_cache
        res = client.post("/settings/import", headers=AUTH, json=exported)
        assert res.status_code == 200
        _workspace_jobs_cache.invalidate_all()

        restored = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        # グローバルジョブを除いたワークスペース固有ジョブの数で比較
        ws_only = {k: v for k, v in restored.items() if not v.get("global")}
        assert len(ws_only) == 1


class TestGitWorkspaceScenario:
    """Gitワークスペースでのブランチ操作 + diff確認"""

    def test_branch_create_and_diff(self, client, git_workspace_with_commit):
        # ブランチ一覧取得
        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        branches = res.json()
        assert any(b == "main" or b == "master" for b in branches)

        # ファイル変更
        (git_workspace_with_commit / "new.txt").write_text("new content\n", encoding="utf-8")

        # diff 取得
        res = client.get("/workspaces/test-ws/diff", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert len(data["files"]) > 0
        assert any(f["name"] == "new.txt" for f in data["files"])

    def test_commit_and_log(self, client, git_workspace_with_commit):
        # ファイル変更 + コミット
        (git_workspace_with_commit / "feature.txt").write_text("feature\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=git_workspace_with_commit, check=True, capture_output=True)

        res = client.post("/workspaces/test-ws/commit", headers=AUTH, json={
            "message": "add feature",
        })
        assert res.status_code == 200

        # ログ確認
        res = client.get("/workspaces/test-ws/git-log?limit=5&skip=0", headers=AUTH)
        assert res.status_code == 200
        assert "add feature" in res.json()["stdout"]
