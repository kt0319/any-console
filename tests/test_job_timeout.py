"""ジョブの timeout_sec 設定テスト"""

import subprocess
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from api.config_schema import JobConfig
from api.job_models import JobDefinition
from api.runner import run_job
from api.common import JOB_TIMEOUT_SEC

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


class TestRunnerTimeout:
    def _make_completed(self):
        r = MagicMock(spec=subprocess.CompletedProcess)
        r.returncode = 0
        r.stdout = ""
        r.stderr = ""
        return r

    def test_uses_job_timeout_sec_when_set(self):
        job = JobDefinition(command="echo hi", label="test", description="", timeout_sec=10)
        with patch("api.runner.subprocess.run", return_value=self._make_completed()) as mock_run:
            run_job(job)
            _, kwargs = mock_run.call_args
            assert kwargs["timeout"] == 10

    def test_uses_default_timeout_when_none(self):
        job = JobDefinition(command="echo hi", label="test", description="", timeout_sec=None)
        with patch("api.runner.subprocess.run", return_value=self._make_completed()) as mock_run:
            run_job(job)
            _, kwargs = mock_run.call_args
            assert kwargs["timeout"] == JOB_TIMEOUT_SEC


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

    def test_timeout_error_reports_custom_timeout_sec(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "slow job",
            "command": "sleep 5",
            "timeout_sec": 600,
        })
        job_name = res.json()["name"]

        with patch("api.routers.job_runner.run_job",
                   side_effect=subprocess.TimeoutExpired(cmd="sleep 5", timeout=600)):
            res = client.post("/run", headers=AUTH, json={"job": job_name, "workspace": "test-ws"})
        assert res.status_code == 504
        assert "600s" in res.json()["detail"]

    def test_timeout_error_reports_default_timeout_sec(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "slow job",
            "command": "sleep 5",
        })
        job_name = res.json()["name"]

        with patch("api.routers.job_runner.run_job",
                   side_effect=subprocess.TimeoutExpired(cmd="sleep 5", timeout=JOB_TIMEOUT_SEC)):
            res = client.post("/run", headers=AUTH, json={"job": job_name, "workspace": "test-ws"})
        assert res.status_code == 504
        assert f"{JOB_TIMEOUT_SEC}s" in res.json()["detail"]

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
