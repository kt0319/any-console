"""初回起動時のトークン自動生成テスト"""

import json

import pytest

import api.auth as auth_module
from api.auth import ensure_default_token


@pytest.fixture(autouse=True)
def isolate_auth(tmp_path, monkeypatch):
    auth_file = tmp_path / "data" / "auth.json"
    monkeypatch.setattr(auth_module, "_AUTH_FILE", auth_file)
    monkeypatch.setattr(auth_module, "ANY_CONSOLE_TOKEN", "")
    yield auth_file


class TestEnsureDefaultToken:
    def test_generates_token_on_first_run(self, isolate_auth):
        auth_file = isolate_auth
        token = ensure_default_token()

        assert token is not None
        assert len(token) == 32
        assert auth_file.exists()
        saved = json.loads(auth_file.read_text())["token"]
        assert saved == token
        assert auth_module.ANY_CONSOLE_TOKEN == token

    def test_no_overwrite_existing_token(self, isolate_auth):
        auth_file = isolate_auth
        auth_file.parent.mkdir(parents=True, exist_ok=True)
        auth_file.write_text(json.dumps({"token": "existing-token"}))
        auth_module.ANY_CONSOLE_TOKEN = "existing-token"

        result = ensure_default_token()

        assert result is None
        assert json.loads(auth_file.read_text())["token"] == "existing-token"

    def test_disable_auth_env_skips_generation(self, isolate_auth, monkeypatch):
        monkeypatch.setenv("ANY_CONSOLE_DISABLE_AUTH", "1")
        from api.main import _is_auth_disabled, _print_token_notice  # noqa: F401

        assert _is_auth_disabled() is True

        # lifespan と同じロジック: 無効化時は ensure_default_token を呼ばない
        auth_file = isolate_auth
        if not _is_auth_disabled():
            ensure_default_token()

        assert not auth_file.exists()
        assert auth_module.ANY_CONSOLE_TOKEN == ""
