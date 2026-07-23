"""ANY_CONSOLE_DATA_DIR による data/・config.json の隔離解決のテスト

E2E の使い捨てサーバモード（playwright.config.js 参照）が前提にする
「env を指定すると data/ と config.json がその配下に隔離される」挙動を確認する。
"""

import os
import subprocess
import sys
import textwrap

from api.common import PROJECT_ROOT, SYSTEM_CMD_TIMEOUT_SEC, resolve_data_paths


class TestResolveDataPaths:
    def test_default_when_env_unset(self):
        data_dir, config_file = resolve_data_paths(None)
        assert data_dir == PROJECT_ROOT / "data"
        assert config_file == PROJECT_ROOT / "config.json"

    def test_default_when_env_blank(self):
        data_dir, config_file = resolve_data_paths("   ")
        assert data_dir == PROJECT_ROOT / "data"
        assert config_file == PROJECT_ROOT / "config.json"

    def test_isolated_when_env_set(self, tmp_path):
        target = tmp_path / "e2e-data"
        data_dir, config_file = resolve_data_paths(str(target))
        assert data_dir == target.resolve()
        assert config_file == data_dir / "config.json"

    def test_relative_env_value_is_resolved_to_absolute(self):
        data_dir, config_file = resolve_data_paths("some-rel-dir")
        assert data_dir.is_absolute()
        assert config_file == data_dir / "config.json"

    def test_env_value_expands_home(self):
        data_dir, _ = resolve_data_paths("~/any-console-e2e")
        assert "~" not in str(data_dir)


def test_env_isolates_all_module_constants(tmp_path):
    """env を設定して import した各モジュールの data/ 配下パスが隔離側を指すこと

    conftest の isolate_fs が定数を monkeypatch するため、本物の import 時解決は
    サブプロセスで確認する（PROJECT_ROOT 直書きに戻る退行をここで検知する）。
    """
    code = textwrap.dedent(
        """
        import sys
        from pathlib import Path

        from api import activity, auth, devices, icons, push
        from api.common import CONFIG_FILE, DATA_DIR
        from api.routers import terminal

        expected = Path(sys.argv[1]).resolve()
        assert DATA_DIR == expected, DATA_DIR
        assert CONFIG_FILE == expected / "config.json"
        assert auth._AUTH_FILE == expected / "auth.json"
        assert devices._DEVICES_FILE == expected / "devices.json"
        assert devices._SERVER_KEY_FILE == expected / "server_key"
        assert activity._BASE == expected / "activity"
        assert icons.ICONS_DIR == expected / "icons"
        assert push._DATA_DIR == expected
        assert terminal._TAB_ORDER_FILE == expected / "sessions.json"
        """
    )
    target = tmp_path / "isolated-data"
    result = subprocess.run(
        [sys.executable, "-c", code, str(target)],
        env={**os.environ, "ANY_CONSOLE_DATA_DIR": str(target)},
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=SYSTEM_CMD_TIMEOUT_SEC * 6,
    )
    assert result.returncode == 0, result.stderr
