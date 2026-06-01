"""グループ CRUD エンドポイントのテスト。"""

import pytest
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture()
def client():
    from api.main import app
    return TestClient(app)


class TestListGroups:
    def test_empty(self, client):
        res = client.get("/groups", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == []

    def test_returns_existing_groups(self, client):
        client.post("/groups", headers=AUTH, json={"name": "Team A"})
        res = client.get("/groups", headers=AUTH)
        assert res.status_code == 200
        groups = res.json()
        assert len(groups) == 1
        assert groups[0]["name"] == "Team A"
        assert "id" in groups[0]


class TestCreateGroup:
    def test_create_returns_id_and_name(self, client):
        res = client.post("/groups", headers=AUTH, json={"name": "My Group"})
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "My Group"
        assert "id" in data

    def test_create_multiple(self, client):
        client.post("/groups", headers=AUTH, json={"name": "A"})
        client.post("/groups", headers=AUTH, json={"name": "B"})
        res = client.get("/groups", headers=AUTH)
        assert len(res.json()) == 2

    def test_empty_name_rejected(self, client):
        res = client.post("/groups", headers=AUTH, json={"name": "   "})
        assert res.status_code == 400

    def test_requires_auth(self, client):
        res = client.post("/groups", json={"name": "X"})
        assert res.status_code == 401


class TestUpdateGroup:
    def test_rename(self, client):
        created = client.post("/groups", headers=AUTH, json={"name": "Old"}).json()
        group_id = created["id"]
        res = client.put(f"/groups/{group_id}", headers=AUTH, json={"name": "New"})
        assert res.status_code == 200
        assert res.json()["name"] == "New"

    def test_rename_reflected_in_list(self, client):
        created = client.post("/groups", headers=AUTH, json={"name": "Before"}).json()
        client.put(f"/groups/{created['id']}", headers=AUTH, json={"name": "After"})
        groups = client.get("/groups", headers=AUTH).json()
        assert groups[0]["name"] == "After"

    def test_empty_name_rejected(self, client):
        created = client.post("/groups", headers=AUTH, json={"name": "X"}).json()
        res = client.put(f"/groups/{created['id']}", headers=AUTH, json={"name": ""})
        assert res.status_code == 400

    def test_not_found(self, client):
        res = client.put("/groups/nonexistent", headers=AUTH, json={"name": "X"})
        assert res.status_code == 404


class TestDeleteGroup:
    def test_delete(self, client):
        created = client.post("/groups", headers=AUTH, json={"name": "ToDelete"}).json()
        res = client.delete(f"/groups/{created['id']}", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert client.get("/groups", headers=AUTH).json() == []

    def test_delete_clears_workspace_group_id(self, client, workspace):
        import json
        import api.common as common_mod

        created = client.post("/groups", headers=AUTH, json={"name": "G"}).json()
        group_id = created["id"]

        config = json.loads(common_mod.CONFIG_FILE.read_text())
        for key, val in config.items():
            if isinstance(val, dict) and val.get("path"):
                val["group_id"] = group_id
        common_mod.CONFIG_FILE.write_text(json.dumps(config))

        client.delete(f"/groups/{group_id}", headers=AUTH)

        config_after = json.loads(common_mod.CONFIG_FILE.read_text())
        for key, val in config_after.items():
            if isinstance(val, dict) and val.get("path"):
                assert val.get("group_id") is None

    def test_not_found(self, client):
        res = client.delete("/groups/nonexistent", headers=AUTH)
        assert res.status_code == 404


class TestGroupOrder:
    def test_reorder_groups(self, client):
        res_a = client.post("/groups", headers=AUTH, json={"name": "A"})
        res_b = client.post("/groups", headers=AUTH, json={"name": "B"})
        res_c = client.post("/groups", headers=AUTH, json={"name": "C"})
        id_a = res_a.json()["id"]
        id_b = res_b.json()["id"]
        id_c = res_c.json()["id"]

        res = client.put("/group-order", headers=AUTH, json={"order": [id_c, id_a, id_b]})
        assert res.status_code == 200

        groups = client.get("/groups", headers=AUTH).json()
        assert [g["id"] for g in groups] == [id_c, id_a, id_b]

    def test_partial_order_puts_unknown_at_end(self, client):
        res_a = client.post("/groups", headers=AUTH, json={"name": "A"})
        res_b = client.post("/groups", headers=AUTH, json={"name": "B"})
        id_a = res_a.json()["id"]
        id_b = res_b.json()["id"]

        # B だけ指定 → A は末尾に回る
        client.put("/group-order", headers=AUTH, json={"order": [id_b]})
        groups = client.get("/groups", headers=AUTH).json()
        assert groups[0]["id"] == id_b
        assert groups[1]["id"] == id_a
