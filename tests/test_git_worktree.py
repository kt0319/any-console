import json

from api.git_utils import parse_worktree_porcelain

from conftest import AUTH


class TestParseWorktreePorcelain:
    def test_parse_main_and_linked(self):
        output = (
            "worktree /home/user/proj\n"
            "HEAD abc123\n"
            "branch refs/heads/main\n"
            "\n"
            "worktree /home/user/proj.worktrees/feature-x\n"
            "HEAD def456\n"
            "branch refs/heads/feature/x\n"
        )
        result = parse_worktree_porcelain(output)
        assert len(result) == 2
        assert result[0]["path"] == "/home/user/proj"
        assert result[0]["branch"] == "main"
        assert result[1]["path"] == "/home/user/proj.worktrees/feature-x"
        assert result[1]["branch"] == "feature/x"

    def test_parse_detached_and_bare(self):
        output = (
            "worktree /repo\n"
            "HEAD abc\n"
            "bare\n"
            "\n"
            "worktree /repo/detached\n"
            "HEAD def\n"
            "detached\n"
        )
        result = parse_worktree_porcelain(output)
        assert result[0]["bare"] is True
        assert result[1]["detached"] is True
        assert result[1]["branch"] is None

    def test_parse_empty(self):
        assert parse_worktree_porcelain("") == []


class TestWorktreeEndpoints:
    def test_create_registers_workspace(self, client, git_workspace_with_commit, isolate_fs):
        res = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "agent-1"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["status"] == "ok"
        assert data["workspace"]["branch"] == "agent-1"

        # 作業ツリーが実体として作られている
        from pathlib import Path
        wt_path = Path(data["workspace"]["path"])
        assert wt_path.is_dir()

        # ワークスペースとして登録されている
        config = json.loads(isolate_fs["config_file"].read_text(encoding="utf-8"))
        names = {v.get("name") for k, v in config.items() if k != "__global__" and isinstance(v, dict)}
        assert data["workspace"]["name"] in names

    def test_worktree_marked_in_workspace_list(self, client, git_workspace_with_commit):
        created = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "agent-wt"},
        ).json()["workspace"]
        res = client.get("/workspaces", headers=AUTH)
        assert res.status_code == 200
        entry = next(w for w in res.json() if w["name"] == created["name"])
        assert entry["worktree"] is True
        assert entry["worktree_base"] == "test-ws"
        assert entry["worktree_branch"] == "agent-wt"
        # 通常のワークスペース（ベース）は worktree フラグを持たない
        base = next(w for w in res.json() if w["name"] == "test-ws")
        assert base.get("worktree") is not True

    def test_metadata_less_worktree_detected_at_runtime(self, client, git_workspace_with_commit, isolate_fs):
        # メタデータ無しで登録された（古い作成を模した）worktree も検出される
        import json
        import subprocess
        from pathlib import Path

        repo = git_workspace_with_commit
        wt_path = Path(str(repo) + ".worktrees") / "legacy"
        subprocess.run(
            ["git", "worktree", "add", str(wt_path), "-b", "legacy"],
            cwd=repo, check=True, capture_output=True,
        )
        # worktree フラグ無しでワークスペース登録する
        cfg_path = isolate_fs["config_file"]
        config = json.loads(cfg_path.read_text(encoding="utf-8"))
        config["legacy-ws"] = {"name": "legacy-ws", "path": str(wt_path)}
        cfg_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

        res = client.get("/workspaces", headers=AUTH)
        entry = next(w for w in res.json() if w["name"] == "legacy-ws")
        assert entry["worktree"] is True
        assert entry["worktree_base"] == "test-ws"
        assert entry["worktree_branch"] == "legacy"

    def test_orphan_worktree_not_marked(self, client, isolate_fs):
        # ベースが登録されていない worktree は worktree 扱いしない（誤アイコン防止）
        import json
        import subprocess
        from pathlib import Path

        base = isolate_fs["work"] / "lonely"
        base.mkdir()
        for cmd in (["git", "init"], ["git", "config", "user.name", "t"], ["git", "config", "user.email", "t@t"]):
            subprocess.run(cmd, cwd=base, capture_output=True)
        (base / "f").write_text("x")
        subprocess.run(["git", "add", "."], cwd=base, capture_output=True)
        subprocess.run(["git", "commit", "-m", "i"], cwd=base, capture_output=True)
        wt = isolate_fs["work"] / "lonely.worktrees" / "feat"
        subprocess.run(
            ["git", "worktree", "add", str(wt), "-b", "feat"],
            cwd=base, check=True, capture_output=True,
        )
        # worktree のみを登録する（ベースは未登録）
        cfg = isolate_fs["config_file"]
        config = json.loads(cfg.read_text(encoding="utf-8")) if cfg.is_file() else {}
        config["only-wt"] = {"name": "only-wt", "path": str(wt)}
        cfg.write_text(json.dumps(config), encoding="utf-8")

        res = client.get("/workspaces", headers=AUTH)
        entry = next(w for w in res.json() if w["name"] == "only-wt")
        assert entry.get("worktree") is not True

    def test_list_shows_worktrees(self, client, git_workspace_with_commit):
        client.post("/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "agent-2"})
        res = client.get("/workspaces/test-ws/worktrees", headers=AUTH)
        assert res.status_code == 200
        worktrees = res.json()["worktrees"]
        branches = {w["branch"] for w in worktrees}
        assert "agent-2" in branches
        # メイン作業ツリーが is_main フラグを持つ
        assert any(w["is_main"] for w in worktrees)

    def test_create_invalid_branch(self, client, git_workspace_with_commit):
        res = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "bad branch!"},
        )
        assert res.status_code == 400

    def test_create_duplicate_conflicts(self, client, git_workspace_with_commit):
        client.post("/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "dup"})
        res = client.post("/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "dup"})
        assert res.status_code == 409

    def test_delete_unregisters_workspace(self, client, git_workspace_with_commit, isolate_fs):
        created = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "agent-3"},
        ).json()
        wt_path = created["workspace"]["path"]
        ws_name = created["workspace"]["name"]

        res = client.request(
            "DELETE", "/workspaces/test-ws/worktrees", headers=AUTH, json={"path": wt_path},
        )
        assert res.status_code == 200, res.text

        config = json.loads(isolate_fs["config_file"].read_text(encoding="utf-8"))
        names = {v.get("name") for k, v in config.items() if k != "__global__" and isinstance(v, dict)}
        assert ws_name not in names

    def test_delete_main_worktree_rejected(self, client, git_workspace_with_commit):
        main_path = str(git_workspace_with_commit)
        res = client.request(
            "DELETE", "/workspaces/test-ws/worktrees", headers=AUTH, json={"path": main_path},
        )
        assert res.status_code == 400

    def test_worktree_shares_base_jobs(self, client, git_workspace_with_commit):
        # ベースにジョブを作成
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Build", "command": "make build",
        })
        created = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "wt-jobs"},
        ).json()["workspace"]
        # worktree のワークスペースからもベースのジョブが見える
        res = client.get(f"/workspaces/{created['name']}/jobs", headers=AUTH)
        assert res.status_code == 200
        labels = {j["label"] for j in res.json().values()}
        assert "Build" in labels

    def test_bulk_jobs_endpoint_shares_base_jobs(self, client, git_workspace_with_commit):
        # UI のモーダルが使う /jobs/workspaces でも worktree がベースのジョブを返す
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "Lint", "command": "ruff check",
        })
        created = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "wt-bulk"},
        ).json()["workspace"]
        res = client.get("/jobs/workspaces", headers=AUTH)
        assert res.status_code == 200
        wt_jobs = res.json().get(created["name"], {})
        labels = {j["label"] for j in wt_jobs.values()}
        assert "Lint" in labels

    def test_worktree_job_edit_writes_to_base(self, client, git_workspace_with_commit):
        created = client.post(
            "/workspaces/test-ws/worktrees", headers=AUTH, json={"branch": "wt-edit"},
        ).json()["workspace"]
        # worktree 側でジョブを作成 → ベースに保存され、ベースからも見える
        client.post(f"/workspaces/{created['name']}/jobs", headers=AUTH, json={
            "label": "Shared", "command": "echo hi",
        })
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        labels = {j["label"] for j in res.json().values()}
        assert "Shared" in labels

    def test_list_on_non_git_rejected(self, client, workspace):
        res = client.get("/workspaces/test-ws/worktrees", headers=AUTH)
        assert res.status_code == 400
