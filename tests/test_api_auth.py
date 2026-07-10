import asyncio
from pathlib import Path

from conftest import AUTH


class _FakeStdin:
    def write(self, _data):
        pass

    async def drain(self):
        pass

    def close(self):
        pass


class _FakeStderr:
    def __init__(self, data):
        self._data = data

    async def read(self):
        return self._data


class _FakeProcess:
    """asyncio.create_subprocess_exec の戻り値をモックする（osascript/xclip呼び出しテスト用）。"""

    def __init__(self, returncode, stderr=b""):
        self.stdin = _FakeStdin()
        self.stderr = _FakeStderr(stderr)
        self.returncode = returncode
        self.pid = 12345

    async def wait(self):
        return self.returncode


# --- 認証 ---


class TestAuth:
    def test_valid_token(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

    def test_missing_token(self, client):
        res = client.get("/auth/check")
        assert res.status_code == 401

    def test_invalid_token(self, client):
        res = client.get("/auth/check", headers={"Authorization": "Bearer wrong"})
        assert res.status_code == 401

    def test_upload_image_too_large_returns_413(self, client, isolate_fs, monkeypatch):
        import api.main as main_mod

        async def fake_clipboard_write(_filepath, _content_type):
            return False

        monkeypatch.setattr(main_mod, "MAX_UPLOAD_SIZE", 10)
        monkeypatch.setattr(main_mod, "UPLOAD_DIR", isolate_fs["data"] / "uploads")
        monkeypatch.setattr(main_mod, "_write_image_to_clipboard", fake_clipboard_write)

        res = client.post(
            "/upload-image",
            headers=AUTH,
            files={"file": ("big.png", b"x" * 20, "image/png")},
        )

        assert res.status_code == 413


class TestWriteImageToClipboard:
    def test_darwin_dispatches_to_macos_writer(self, monkeypatch):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.sys, "platform", "darwin")
        called = {}

        async def fake_macos(filepath):
            called["filepath"] = filepath
            return True

        monkeypatch.setattr(main_mod, "_write_image_to_clipboard_macos", fake_macos)
        result = asyncio.run(main_mod._write_image_to_clipboard(Path("/tmp/x.png"), "image/png"))

        assert result is True
        assert called["filepath"] == Path("/tmp/x.png")

    def test_linux_dispatches_to_linux_writer(self, monkeypatch):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.sys, "platform", "linux")
        called = {}

        async def fake_linux(filepath, content_type):
            called["filepath"] = filepath
            called["content_type"] = content_type
            return True

        monkeypatch.setattr(main_mod, "_write_image_to_clipboard_linux", fake_linux)
        result = asyncio.run(main_mod._write_image_to_clipboard(Path("/tmp/x.png"), "image/png"))

        assert result is True
        assert called == {"filepath": Path("/tmp/x.png"), "content_type": "image/png"}

    def test_unsupported_platform_returns_false(self, monkeypatch):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.sys, "platform", "win32")
        result = asyncio.run(main_mod._write_image_to_clipboard(Path("/tmp/x.png"), "image/png"))

        assert result is False

    def test_macos_writer_returns_false_without_osascript(self, monkeypatch):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.shutil, "which", lambda _cmd: None)
        result = asyncio.run(main_mod._write_image_to_clipboard_macos(Path("/tmp/x.png")))

        assert result is False

    def test_macos_writer_passes_path_via_env_and_reports_success(self, monkeypatch, tmp_path):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.shutil, "which", lambda cmd: "/usr/bin/osascript" if cmd == "osascript" else None)
        filepath = tmp_path / "shot.png"
        filepath.write_bytes(b"fake-png")
        captured: dict = {}

        async def fake_create_subprocess_exec(*args, **kwargs):
            captured["args"] = args
            captured["env"] = kwargs.get("env")
            return _FakeProcess(returncode=0)

        monkeypatch.setattr(main_mod.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        result = asyncio.run(main_mod._write_image_to_clipboard_macos(filepath))

        assert result is True
        assert captured["args"] == ("osascript", "-")
        assert captured["env"]["AC_IMAGE_PATH"] == str(filepath)

    def test_macos_writer_returns_false_on_nonzero_exit(self, monkeypatch, tmp_path):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.shutil, "which", lambda cmd: "/usr/bin/osascript" if cmd == "osascript" else None)
        filepath = tmp_path / "shot.png"
        filepath.write_bytes(b"fake-png")

        async def fake_create_subprocess_exec(*_args, **_kwargs):
            return _FakeProcess(returncode=1, stderr=b"boom")

        monkeypatch.setattr(main_mod.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        result = asyncio.run(main_mod._write_image_to_clipboard_macos(filepath))

        assert result is False

    def test_linux_writer_returns_false_without_xclip(self, monkeypatch, tmp_path):
        import api.main as main_mod

        monkeypatch.setattr(main_mod.shutil, "which", lambda _cmd: None)
        filepath = tmp_path / "shot.png"
        filepath.write_bytes(b"fake-png")

        result = asyncio.run(main_mod._write_image_to_clipboard_linux(filepath, "image/png"))

        assert result is False
