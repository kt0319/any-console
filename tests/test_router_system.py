"""api/routers/system.py のテスト。

OS依存の getter は subprocess / ファイル読み取りを mock してテストする。
"""

import subprocess

import pytest

import api.routers.system as system_mod
from conftest import AUTH


class TestFormatUptimeSeconds:
    def test_zero(self):
        assert system_mod._format_uptime_seconds(0) == "up 0 minutes"

    def test_minutes_only(self):
        assert system_mod._format_uptime_seconds(60) == "up 1 minute"
        assert system_mod._format_uptime_seconds(120) == "up 2 minutes"

    def test_hours_and_minutes(self):
        # 1 hour + 30 minutes
        assert system_mod._format_uptime_seconds(3600 + 30 * 60) == "up 1 hour, 30 minutes"

    def test_days(self):
        # 2 days + 3 hours
        assert system_mod._format_uptime_seconds(2 * 86400 + 3 * 3600) == "up 2 days, 3 hours"


class TestGetIp:
    def test_linux_hostname_dash_i(self, monkeypatch):
        monkeypatch.setattr(system_mod, "IS_DARWIN", False)
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: "192.168.1.10 10.0.0.1\n")
        assert system_mod._get_ip() == "192.168.1.10"

    def test_linux_falls_back_to_gethostbyname(self, monkeypatch):
        monkeypatch.setattr(system_mod, "IS_DARWIN", False)
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: "")
        monkeypatch.setattr(system_mod.socket, "gethostbyname", lambda h: "127.0.0.1")
        assert system_mod._get_ip() == "127.0.0.1"

    def test_gaierror_returns_none(self, monkeypatch):
        import socket as sock_mod
        monkeypatch.setattr(system_mod, "IS_DARWIN", False)
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: "")

        def raise_gaierror(_):
            raise sock_mod.gaierror("unknown host")
        monkeypatch.setattr(system_mod.socket, "gethostbyname", raise_gaierror)
        assert system_mod._get_ip() is None


class TestGetOsName:
    def test_darwin(self, monkeypatch):
        monkeypatch.setattr(system_mod, "IS_DARWIN", True)
        monkeypatch.setattr(system_mod.platform, "mac_ver", lambda: ("14.0", ("", "", ""), ""))
        assert system_mod._get_os_name() == "macOS 14.0"

    def test_linux_pretty_name(self, monkeypatch, tmp_path):
        os_release = tmp_path / "os-release"
        os_release.write_text('PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\n', encoding="utf-8")
        monkeypatch.setattr(system_mod, "IS_DARWIN", False)
        monkeypatch.setattr(system_mod, "Path", lambda p: os_release if p == "/etc/os-release" else __import__("pathlib").Path(p))
        assert system_mod._get_os_name() == "Debian GNU/Linux 12 (bookworm)"


class TestGetUptime:
    def test_darwin_parses_boottime(self, monkeypatch):
        import time as time_mod
        monkeypatch.setattr(system_mod, "IS_DARWIN", True)
        # boottime stdout
        boot = int(time_mod.time()) - 3600  # 1時間前起動
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: f"{{ sec = {boot}, usec = 0 }}")
        result = system_mod._get_uptime()
        assert result is not None
        assert "hour" in result

    def test_linux_uses_uptime_p(self, monkeypatch):
        monkeypatch.setattr(system_mod, "IS_DARWIN", False)
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: "up 5 minutes\n")
        assert system_mod._get_uptime() == "up 5 minutes"


class TestGetCpuTemp:
    def test_darwin_returns_none(self, monkeypatch):
        monkeypatch.setattr(system_mod, "IS_DARWIN", True)
        assert system_mod._get_cpu_temp() is None


class TestGetMemoryLinux:
    def test_parses_meminfo(self, monkeypatch, tmp_path):
        meminfo = tmp_path / "meminfo"
        meminfo.write_text(
            "MemTotal:       8192000 kB\nMemAvailable:   4096000 kB\n",
            encoding="utf-8",
        )
        from pathlib import Path as _Path
        monkeypatch.setattr(system_mod, "Path", lambda p: meminfo if p == "/proc/meminfo" else _Path(p))
        result = system_mod._get_memory_linux()
        assert result is not None
        assert "GB" in result

    def test_missing_memtotal_returns_none(self, monkeypatch, tmp_path):
        meminfo = tmp_path / "meminfo"
        meminfo.write_text("Other: 123\n", encoding="utf-8")
        from pathlib import Path as _Path
        monkeypatch.setattr(system_mod, "Path", lambda p: meminfo if p == "/proc/meminfo" else _Path(p))
        assert system_mod._get_memory_linux() is None


class TestSystemInfoEndpoint:
    def test_returns_basic_fields(self, client, monkeypatch):
        # OS依存の getter を全部スタブ
        monkeypatch.setattr(system_mod, "_get_ip", lambda: "192.168.1.1")
        monkeypatch.setattr(system_mod, "_get_os_name", lambda: "Test OS")
        monkeypatch.setattr(system_mod, "_get_uptime", lambda: "up 1 minute")
        monkeypatch.setattr(system_mod, "_get_cpu_temp", lambda: "50.0 °C")
        monkeypatch.setattr(system_mod, "_get_memory", lambda: "1.0 / 8.0 GB")
        monkeypatch.setattr(system_mod, "_get_tailscale_info", lambda: None)

        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "hostname" in data
        assert "user" in data
        assert "install_dir" in data
        assert data["ip"] == "192.168.1.1"
        assert data["os"] == "Test OS"
        assert data["uptime"] == "up 1 minute"

    def test_omits_none_values(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_ip", lambda: None)
        monkeypatch.setattr(system_mod, "_get_os_name", lambda: None)
        monkeypatch.setattr(system_mod, "_get_uptime", lambda: None)
        monkeypatch.setattr(system_mod, "_get_cpu_temp", lambda: None)
        monkeypatch.setattr(system_mod, "_get_memory", lambda: None)
        monkeypatch.setattr(system_mod, "_get_tailscale_info", lambda: None)

        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        # 必須フィールド
        assert "hostname" in data
        # None の getter は省略される
        assert "ip" not in data
        assert "os" not in data
        assert "tailscale" not in data

    def test_includes_tailscale_when_detected(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_ip", lambda: None)
        monkeypatch.setattr(system_mod, "_get_os_name", lambda: None)
        monkeypatch.setattr(system_mod, "_get_uptime", lambda: None)
        monkeypatch.setattr(system_mod, "_get_cpu_temp", lambda: None)
        monkeypatch.setattr(system_mod, "_get_memory", lambda: None)
        monkeypatch.setattr(
            system_mod, "_get_tailscale_info",
            lambda: {"version": "1.98.9", "serve_running": True, "https_enabled": True,
                      "trust_auth_enabled": False, "auth_config_safe": True},
        )

        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["tailscale"]["version"] == "1.98.9"
        assert data["tailscale"]["auth_config_safe"] is True


class TestGetTailscaleInfo:
    def test_not_installed_returns_none(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_tailscale_version", lambda: None)
        assert system_mod._get_tailscale_info() is None

    def test_trust_disabled_is_always_safe(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_tailscale_version", lambda: "1.98.9")
        monkeypatch.setattr(system_mod, "_get_tailscale_serve_running", lambda: False)
        monkeypatch.setattr(system_mod, "_is_tailscale_trust_enabled", lambda: False)
        monkeypatch.delenv("SSL_KEYFILE", raising=False)
        monkeypatch.delenv("SSL_CERTFILE", raising=False)
        info = system_mod._get_tailscale_info()
        assert info["trust_auth_enabled"] is False
        assert info["auth_config_safe"] is True

    def test_trust_enabled_with_serve_and_https_is_safe(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_tailscale_version", lambda: "1.98.9")
        monkeypatch.setattr(system_mod, "_get_tailscale_serve_running", lambda: True)
        monkeypatch.setattr(system_mod, "_is_tailscale_trust_enabled", lambda: True)
        monkeypatch.setenv("SSL_KEYFILE", "/tmp/key")
        monkeypatch.setenv("SSL_CERTFILE", "/tmp/cert")
        info = system_mod._get_tailscale_info()
        assert info["https_enabled"] is True
        assert info["auth_config_safe"] is True

    def test_trust_enabled_without_serve_is_unsafe(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_tailscale_version", lambda: "1.98.9")
        monkeypatch.setattr(system_mod, "_get_tailscale_serve_running", lambda: False)
        monkeypatch.setattr(system_mod, "_is_tailscale_trust_enabled", lambda: True)
        monkeypatch.setenv("SSL_KEYFILE", "/tmp/key")
        monkeypatch.setenv("SSL_CERTFILE", "/tmp/cert")
        info = system_mod._get_tailscale_info()
        assert info["auth_config_safe"] is False

    def test_trust_enabled_without_https_is_unsafe(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_tailscale_version", lambda: "1.98.9")
        monkeypatch.setattr(system_mod, "_get_tailscale_serve_running", lambda: True)
        monkeypatch.setattr(system_mod, "_is_tailscale_trust_enabled", lambda: True)
        monkeypatch.delenv("SSL_KEYFILE", raising=False)
        monkeypatch.delenv("SSL_CERTFILE", raising=False)
        info = system_mod._get_tailscale_info()
        assert info["auth_config_safe"] is False


class TestGetTailscaleVersion:
    def test_parses_first_line(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: "1.98.9\ntailscale commit: abc\n")
        assert system_mod._get_tailscale_version() == "1.98.9"

    def test_not_installed_returns_none(self, monkeypatch):
        monkeypatch.setattr(system_mod, "_run_cmd_safe", lambda cmd: None)
        assert system_mod._get_tailscale_version() is None


class TestGetTailscaleServeRunning:
    def test_running_with_web_handlers(self, monkeypatch):
        data = {"TCP": {"443": {"HTTPS": True}}, "Web": {"x": {}}}
        monkeypatch.setattr(system_mod, "run_tailscale_json", lambda args: data)
        assert system_mod._get_tailscale_serve_running() is True

    def test_not_configured(self, monkeypatch):
        monkeypatch.setattr(system_mod, "run_tailscale_json", lambda args: {})
        assert system_mod._get_tailscale_serve_running() is False

    def test_command_unavailable_returns_none(self, monkeypatch):
        monkeypatch.setattr(system_mod, "run_tailscale_json", lambda args: None)
        assert system_mod._get_tailscale_serve_running() is None


class TestSystemProcessesEndpoint:
    def test_returns_processes(self, client, monkeypatch):
        ps_output = (
            "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n"
            "root 1 1.5 0.5 1234 5678 ? S 00:00 0:01 /sbin/init\n"
            "user 2 2.0 1.0 2345 6789 ? S 00:01 0:02 python app.py\n"
        )
        fake = subprocess.CompletedProcess(["ps"], 0, stdout=ps_output, stderr="")
        monkeypatch.setattr(system_mod, "run_subprocess_safe", lambda *a, **kw: fake)
        res = client.get("/system/processes", headers=AUTH)
        assert res.status_code == 200
        procs = res.json()
        assert len(procs) >= 1
        assert procs[0]["pid"] == 1
        assert procs[0]["cpu"] == 1.5

    def test_ps_failure_returns_500(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "run_subprocess_safe", lambda *a, **kw: None)
        res = client.get("/system/processes", headers=AUTH)
        assert res.status_code == 500


def _completed(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(["git"], returncode, stdout, stderr)


class TestVersionInSystemInfo:
    def test_version_included(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "get_app_release", lambda: "v0.5.0-3-gabc123")
        for getter in ("_get_ip", "_get_os_name", "_get_uptime", "_get_cpu_temp", "_get_memory"):
            monkeypatch.setattr(system_mod, getter, lambda: None)
        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["version"] == "v0.5.0-3-gabc123"

    def test_version_omitted_when_empty(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "get_app_release", lambda: "")
        for getter in ("_get_ip", "_get_os_name", "_get_uptime", "_get_cpu_temp", "_get_memory"):
            monkeypatch.setattr(system_mod, getter, lambda: None)
        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        assert "version" not in res.json()


def _git_out_table(table, default=None):
    def fn(args, timeout=0):
        return table.get(" ".join(args), default)
    return fn


class TestCheckUpdate:
    def _patch(self, monkeypatch, table, fetch_rc=0):
        monkeypatch.setattr(system_mod, "_git_out", _git_out_table(table))
        monkeypatch.setattr(system_mod, "_git", lambda args, timeout=0: _completed(returncode=fetch_rc))

    def test_update_available(self, client, monkeypatch):
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "remote": "origin",
            "describe --tags --always": "v0.5.0-3-gabc",
            "describe --tags --abbrev=0": "v0.5.0",
            "tag --sort=-v:refname": "v0.6.0\nv0.5.0\nv0.3.0",
            "rev-list --count v0.5.0..v0.6.0": "12",
        })
        res = client.get("/system/update/check", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["update_available"] is True
        assert data["behind"] == 12
        assert data["latest_release"] == "v0.6.0"
        assert data["current_release"] == "v0.5.0"
        assert data["version"] == "v0.5.0-3-gabc"
        assert data["fetch_ok"] is True

    def test_up_to_date(self, client, monkeypatch):
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "remote": "origin",
            "describe --tags --always": "v0.6.0",
            "describe --tags --abbrev=0": "v0.6.0",
            "tag --sort=-v:refname": "v0.6.0\nv0.5.0",
        })
        res = client.get("/system/update/check", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["update_available"] is False
        assert data["behind"] == 0

    def test_fetch_failure_sets_flag(self, client, monkeypatch):
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "remote": "origin",
            "describe --tags --abbrev=0": "v0.6.0",
            "tag --sort=-v:refname": "v0.6.0",
        }, fetch_rc=1)
        res = client.get("/system/update/check", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["fetch_ok"] is False

    def test_update_available_when_no_current_tag(self, client, monkeypatch):
        # 現在タグが取れない（describe 失敗）が最新タグはある -> 更新あり
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "remote": "origin",
            "tag --sort=-v:refname": "v0.6.0",
        })
        res = client.get("/system/update/check", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["current_release"] == ""
        assert data["update_available"] is True

    def test_not_a_git_repo_returns_500(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "_git_out", lambda args, timeout=0: None)
        monkeypatch.setattr(system_mod, "_git", lambda args, timeout=0: _completed())
        res = client.get("/system/update/check", headers=AUTH)
        assert res.status_code == 500


class TestApplyUpdate:
    def _patch(self, monkeypatch, table, git_fn):
        monkeypatch.setattr(system_mod, "_git_out", _git_out_table(table))
        monkeypatch.setattr(system_mod, "_git", git_fn)

    def test_success(self, client, monkeypatch):
        def git_fn(args, timeout=0):
            return _completed()  # fetch も checkout も成功
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "status --porcelain": "",
            "remote": "origin",
            "tag --sort=-v:refname": "v0.6.0\nv0.5.0",
            "describe --tags --always": "v0.6.0",
        }, git_fn)
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["restart_required"] is True
        assert data["checked_out"] == "v0.6.0"
        assert data["version"] == "v0.6.0"

    def test_dirty_tree_returns_409(self, client, monkeypatch):
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "status --porcelain": " M api/foo.py",
        }, lambda args, timeout=0: _completed())
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 409

    def test_not_a_git_repo_returns_500(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "_git_out", lambda args, timeout=0: None)
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 500

    def test_fetch_failure_returns_500(self, client, monkeypatch):
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "status --porcelain": "",
            "remote": "origin",
        }, lambda args, timeout=0: _completed(returncode=1, stderr="network"))
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 500

    def test_no_tags_returns_500(self, client, monkeypatch):
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "status --porcelain": "",
            "remote": "origin",
            "tag --sort=-v:refname": "",
        }, lambda args, timeout=0: _completed())  # fetch 成功
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 500

    def test_checkout_failure_returns_500(self, client, monkeypatch):
        def git_fn(args, timeout=0):
            if "checkout" in args:
                return _completed(returncode=1, stderr="checkout failed")
            return _completed()  # fetch 成功
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "status --porcelain": "",
            "remote": "origin",
            "tag --sort=-v:refname": "v0.6.0",
        }, git_fn)
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 500

    def test_checkout_none_returns_500(self, client, monkeypatch):
        def git_fn(args, timeout=0):
            return None if "checkout" in args else _completed()
        self._patch(monkeypatch, {
            "rev-parse --is-inside-work-tree": "true",
            "status --porcelain": "",
            "remote": "origin",
            "tag --sort=-v:refname": "v0.6.0",
        }, git_fn)
        res = client.post("/system/update/apply", headers=AUTH)
        assert res.status_code == 500
