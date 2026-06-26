import json

from conftest import AUTH, find_ws_id


# --- ジョブCRUD ---


class TestJobsCRUD:
    def test_list_all_workspace_jobs(self, client, workspace, isolate_fs):
        second = isolate_fs["work"] / "second-ws"
        second.mkdir()
        config = json.loads(isolate_fs["config_file"].read_text(encoding="utf-8"))
        config["second-ws"] = {"path": str(second)}
        isolate_fs["config_file"].write_text(json.dumps(config), encoding="utf-8")

        first_job = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "hello",
            "command": "echo hello",
        }).json()["name"]
        second_job = client.post("/workspaces/second-ws/jobs", headers=AUTH, json={
            "label": "bye",
            "command": "echo bye",
            "detached_tab": False,
        }).json()["name"]

        res = client.get("/jobs/workspaces", headers=AUTH)

        assert res.status_code == 200
        data = res.json()
        assert data["test-ws"][first_job]["command"] == "echo hello"
        assert data["second-ws"][second_job]["command"] == "echo bye"
        assert data["second-ws"][second_job]["detached_tab"] is False

    def test_list_empty(self, client, workspace):
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_create_and_list(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "hello",
            "command": "echo hello",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        assert job_name.startswith("job_")

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["command"] == "echo hello"
        assert jobs[job_name]["label"] == "hello"

    def test_create_requires_label(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "command": "echo 1",
        })
        assert res.status_code == 422

    def test_create_empty_label(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "  ",
            "command": "echo x",
        })
        assert res.status_code == 400

    def test_create_empty_command(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "empty",
            "command": "  ",
        })
        assert res.status_code == 400

    def test_update_job(self, client, workspace):
        create_res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "upd",
            "command": "echo old",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.put(f"/workspaces/test-ws/jobs/{job_name}", headers=AUTH, json={
            "label": "upd",
            "command": "echo new",
        })
        assert res.status_code == 200

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.json()[job_name]["command"] == "echo new"

    def test_update_nonexistent(self, client, workspace):
        res = client.put("/workspaces/test-ws/jobs/ghost", headers=AUTH, json={
            "label": "ghost",
            "command": "echo x",
        })
        assert res.status_code == 404

    def test_delete_job(self, client, workspace):
        create_res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "del",
            "command": "echo del",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.delete(f"/workspaces/test-ws/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert job_name not in res.json()

    def test_delete_nonexistent(self, client, workspace):
        res = client.delete("/workspaces/test-ws/jobs/ghost", headers=AUTH)
        assert res.status_code == 404

    def test_reorder_jobs(self, client, workspace):
        first = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        second = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        }).json()["name"]
        third = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "third",
            "command": "echo third",
        }).json()["name"]

        res = client.put("/workspaces/test-ws/job-order", headers=AUTH, json={
            "order": [third, first, second],
        })
        assert res.status_code == 200

        jobs = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        assert list(jobs.keys()) == [third, first, second]

    def test_reorder_jobs_rejects_missing_items(self, client, workspace):
        first = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        })

        res = client.put("/workspaces/test-ws/job-order", headers=AUTH, json={
            "order": [first],
        })
        assert res.status_code == 400

    def test_create_with_icon(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "iconic",
            "command": "echo x",
            "icon": "mdi-star",
            "icon_color": "#ff0000",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        jobs = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        assert jobs[job_name]["icon"] == "mdi-star"
        assert jobs[job_name]["icon_color"] == "#ff0000"
        assert jobs[job_name]["confirm"] is False

    def test_nonexistent_workspace(self, client):
        res = client.get("/workspaces/no-such-ws/jobs", headers=AUTH)
        assert res.status_code == 400


class TestCommonJobsCRUD:
    def test_list_empty(self, client):
        res = client.get("/common/jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_create_and_list(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "hello",
            "command": "echo hello",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        assert job_name.startswith("job_")

        res = client.get("/common/jobs", headers=AUTH)
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["command"] == "echo hello"
        assert jobs[job_name]["label"] == "hello"

    def test_create_requires_label(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "command": "echo 1",
        })
        assert res.status_code == 422

    def test_create_empty_label(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "  ",
            "command": "echo x",
        })
        assert res.status_code == 400

    def test_create_empty_command(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "empty",
            "command": "  ",
        })
        assert res.status_code == 400

    def test_update_job(self, client):
        create_res = client.post("/common/jobs", headers=AUTH, json={
            "label": "upd",
            "command": "echo old",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.put(f"/common/jobs/{job_name}", headers=AUTH, json={
            "label": "upd",
            "command": "echo new",
        })
        assert res.status_code == 200

        res = client.get("/common/jobs", headers=AUTH)
        assert res.json()[job_name]["command"] == "echo new"

    def test_update_nonexistent(self, client):
        res = client.put("/common/jobs/ghost", headers=AUTH, json={
            "label": "ghost",
            "command": "echo x",
        })
        assert res.status_code == 404

    def test_delete_job(self, client):
        create_res = client.post("/common/jobs", headers=AUTH, json={
            "label": "del",
            "command": "echo del",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.delete(f"/common/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200

        res = client.get("/common/jobs", headers=AUTH)
        assert job_name not in res.json()

    def test_delete_nonexistent(self, client):
        res = client.delete("/common/jobs/ghost", headers=AUTH)
        assert res.status_code == 404

    def test_reorder_jobs(self, client):
        first = client.post("/common/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        second = client.post("/common/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        }).json()["name"]
        third = client.post("/common/jobs", headers=AUTH, json={
            "label": "third",
            "command": "echo third",
        }).json()["name"]

        res = client.put("/common/job-order", headers=AUTH, json={
            "order": [third, first, second],
        })
        assert res.status_code == 200

        jobs = client.get("/common/jobs", headers=AUTH).json()
        assert list(jobs.keys()) == [third, first, second]

    def test_reorder_rejects_missing_items(self, client):
        first = client.post("/common/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        client.post("/common/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        })

        res = client.put("/common/job-order", headers=AUTH, json={
            "order": [first],
        })
        assert res.status_code == 400

    def test_create_with_icon(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "iconic",
            "command": "echo x",
            "icon": "mdi-star",
            "icon_color": "#ff0000",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        jobs = client.get("/common/jobs", headers=AUTH).json()
        assert jobs[job_name]["icon"] == "mdi-star"
        assert jobs[job_name]["icon_color"] == "#ff0000"
        assert jobs[job_name]["confirm"] is False

    def test_common_jobs_appear_in_workspace(self, client, workspace):
        create_res = client.post("/common/jobs", headers=AUTH, json={
            "label": "common task",
            "command": "echo common",
        })
        job_name = create_res.json()["name"]

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["command"] == "echo common"
        assert jobs[job_name]["common"] is True

    def test_workspace_job_overrides_common(self, client, workspace, isolate_fs):
        common_res = client.post("/common/jobs", headers=AUTH, json={
            "label": "shared",
            "command": "echo common",
        })
        common_job_name = common_res.json()["name"]

        config = json.loads(isolate_fs["config_file"].read_text(encoding="utf-8"))
        ws_id = find_ws_id(config, "test-ws") or "test-ws"
        config.setdefault(ws_id, {}).setdefault("jobs", {})[common_job_name] = {
            "label": "shared",
            "command": "echo workspace",
        }
        isolate_fs["config_file"].write_text(json.dumps(config), encoding="utf-8")

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        jobs = res.json()
        assert jobs[common_job_name]["command"] == "echo workspace"
        assert jobs[common_job_name]["common"] is False

    def test_all_workspace_jobs_includes_common(self, client, workspace):
        create_res = client.post("/common/jobs", headers=AUTH, json={
            "label": "common for all",
            "command": "echo common",
        })
        job_name = create_res.json()["name"]

        res = client.get("/jobs/workspaces", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "test-ws" in data
        assert job_name in data["test-ws"]
        assert data["test-ws"][job_name]["common"] is True
