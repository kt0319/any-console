"""ジョブの timeout_sec 設定テスト"""

import pytest
from pydantic import ValidationError

from api.config_schema import JobConfig

from conftest import AUTH


class TestJobConfigSchema:
    def test_timeout_sec_none_is_valid(self):
        j = JobConfig(command="echo hi")
        assert j.timeout_sec is None

    def test_timeout_sec_valid_value(self):
        j = JobConfig(command="echo hi", timeout_sec=60)
        assert j.timeout_sec == 60

    def test_timeout_sec_max_boundary(self):
        j = JobConfig(command="echo hi", timeout_sec=86400)
        assert j.timeout_sec == 86400

    def test_timeout_sec_zero_is_invalid(self):
        with pytest.raises(ValidationError):
            JobConfig(command="echo hi", timeout_sec=0)

    def test_timeout_sec_negative_is_invalid(self):
        with pytest.raises(ValidationError):
            JobConfig(command="echo hi", timeout_sec=-1)

    def test_timeout_sec_over_max_is_invalid(self):
        with pytest.raises(ValidationError):
            JobConfig(command="echo hi", timeout_sec=86401)


class TestJobApiTimeout:
    def test_save_job_with_timeout_sec(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "slow job",
            "command": "sleep 1",
            "timeout_sec": 600,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        job = res.json()[job_name]
        assert job["timeout_sec"] == 600

    def test_save_job_without_timeout_sec(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "fast job",
            "command": "echo hi",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        job = res.json()[job_name]
        assert job.get("timeout_sec") is None

    def test_save_job_timeout_sec_over_max(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "bad job",
            "command": "echo hi",
            "timeout_sec": 99999,
        })
        assert res.status_code == 422

    def test_save_job_timeout_sec_zero(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "bad job",
            "command": "echo hi",
            "timeout_sec": 0,
        })
        assert res.status_code == 422
