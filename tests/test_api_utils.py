import pytest


# --- ユーティリティ ---


class TestUtils:
    def test_validate_commit_ref_valid(self):
        from api.validators import validate_commit_ref

        assert validate_commit_ref("abcd") == "abcd"
        assert validate_commit_ref("a" * 40) == "a" * 40

    def test_validate_commit_ref_invalid(self):
        from api.validators import validate_commit_ref
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            validate_commit_ref("xyz")
        assert exc_info.value.status_code == 400

        with pytest.raises(HTTPException):
            validate_commit_ref("abc")

        with pytest.raises(HTTPException):
            validate_commit_ref("ABCD")

    def test_resolve_workspace_path_invalid(self):
        from api.common import resolve_workspace_path
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("../etc")
        assert exc_info.value.status_code == 400

    def test_resolve_workspace_path_not_found(self):
        from api.common import resolve_workspace_path
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("nonexistent")
        assert exc_info.value.status_code == 400

    def test_resolve_workspace_path_none(self):
        from api.common import resolve_workspace_path

        assert resolve_workspace_path(None) is None
        assert resolve_workspace_path("") is None


class TestRunCmdSafe:
    """system._run_cmd_safe のユニットテスト"""

    def test_success_returns_stdout(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: sp.CompletedProcess(cmd, 0, stdout="hello\n", stderr=""))
        assert _run_cmd_safe(["echo", "hello"]) == "hello\n"

    def test_nonzero_exit_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: sp.CompletedProcess(cmd, 1, stdout="", stderr="err"))
        assert _run_cmd_safe(["false"]) is None

    def test_timeout_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        def raise_timeout(cmd, **kwargs):
            raise sp.TimeoutExpired(cmd, 5)

        monkeypatch.setattr(sp, "run", raise_timeout)
        assert _run_cmd_safe(["sleep", "99"]) is None

    def test_file_not_found_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: (_ for _ in ()).throw(FileNotFoundError("no such file")))
        assert _run_cmd_safe(["no-such-cmd"]) is None

    def test_oserror_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: (_ for _ in ()).throw(OSError("permission denied")))
        assert _run_cmd_safe(["restricted-cmd"]) is None


# --- save_json_file（アトミック書き込み） ---


class TestSaveJsonFile:
    def test_roundtrip_and_parent_creation(self, tmp_path):
        from api.common import load_json_file, save_json_file

        target = tmp_path / "nested" / "data.json"
        save_json_file(target, {"devices": [{"id": "dev_1"}]})
        assert load_json_file(target, None) == {"devices": [{"id": "dev_1"}]}

    def test_overwrite_leaves_no_tmp_file(self, tmp_path):
        from api.common import load_json_file, save_json_file

        target = tmp_path / "data.json"
        save_json_file(target, {"v": 1})
        save_json_file(target, {"v": 2})
        assert load_json_file(target, None) == {"v": 2}
        # tmp 経由のアトミック書き込み後、一時ファイルが残らない
        assert list(tmp_path.glob("*.tmp")) == []

    def test_concurrent_writers_do_not_conflict(self, tmp_path):
        """並行ライター同士でも rename 競合（FileNotFoundError）せず、最終状態が有効な JSON になる。"""
        import json
        from concurrent.futures import ThreadPoolExecutor

        from api.common import save_json_file

        target = tmp_path / "data.json"
        errors = []

        def writer(i):
            try:
                for _ in range(20):
                    save_json_file(target, {"writer": i})
            except OSError as e:
                errors.append(e)

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(writer, range(8)))

        assert errors == []
        assert "writer" in json.loads(target.read_text(encoding="utf-8"))
        assert list(tmp_path.glob("*.tmp")) == []

    def test_concurrent_readers_never_see_partial_json(self, tmp_path):
        """並行リーダーが書き込み途中の JSON を読まない（os.replace によるアトミック性）。

        devices.json は認証リクエストごとに書き換わるため、torn read が起きると
        認証失敗（401）につながる。読者は常に完全な JSON を読めること。
        """
        import json
        import threading

        from api.common import save_json_file

        target = tmp_path / "data.json"
        payload = {"devices": [{"id": f"dev_{i}", "hash": "x" * 64} for i in range(200)]}
        save_json_file(target, payload)

        errors = []
        stop = threading.Event()

        def reader():
            while not stop.is_set():
                try:
                    data = json.loads(target.read_text(encoding="utf-8"))
                    assert len(data["devices"]) == 200
                except (json.JSONDecodeError, AssertionError) as e:  # torn read を検出
                    errors.append(e)
                    return

        threads = [threading.Thread(target=reader) for _ in range(4)]
        for t in threads:
            t.start()
        for _ in range(50):
            save_json_file(target, payload)
        stop.set()
        for t in threads:
            t.join()
        assert errors == []
