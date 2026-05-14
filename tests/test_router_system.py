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

        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "hostname" in data
        assert "user" in data
        assert "work_dir" in data
        assert data["ip"] == "192.168.1.1"
        assert data["os"] == "Test OS"
        assert data["uptime"] == "up 1 minute"

    def test_omits_none_values(self, client, monkeypatch):
        monkeypatch.setattr(system_mod, "_get_ip", lambda: None)
        monkeypatch.setattr(system_mod, "_get_os_name", lambda: None)
        monkeypatch.setattr(system_mod, "_get_uptime", lambda: None)
        monkeypatch.setattr(system_mod, "_get_cpu_temp", lambda: None)
        monkeypatch.setattr(system_mod, "_get_memory", lambda: None)

        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        # 必須フィールド
        assert "hostname" in data
        # None の getter は省略される
        assert "ip" not in data
        assert "os" not in data


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
