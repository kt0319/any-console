from conftest import AUTH


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
