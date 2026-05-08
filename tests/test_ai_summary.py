"""api/ai_summary.py のテスト。"""

import builtins
import sys
from unittest import mock

import pytest


class TestSummarizePull:
    def test_empty_stdout_returns_none(self):
        from api.ai_summary import summarize_pull
        assert summarize_pull("") is None

    def test_already_up_to_date_returns_none(self):
        from api.ai_summary import summarize_pull
        assert summarize_pull("Already up to date.") is None

    def test_no_api_key_returns_none(self, monkeypatch):
        from api.ai_summary import summarize_pull
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        assert summarize_pull("1 file changed, 2 insertions(+)") is None

    def test_anthropic_not_installed_returns_none(self, monkeypatch):
        from api.ai_summary import summarize_pull
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        monkeypatch.delitem(sys.modules, "anthropic", raising=False)
        real_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "anthropic":
                raise ImportError("No module named 'anthropic'")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", mock_import)
        assert summarize_pull("1 file changed") is None

    def test_anthropic_api_success(self, monkeypatch):
        from api.ai_summary import summarize_pull
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        mock_anthropic = mock.MagicMock()
        mock_content = mock.MagicMock()
        mock_content.text = "  1ファイル更新  "
        mock_anthropic.Anthropic.return_value.messages.create.return_value.content = [mock_content]
        monkeypatch.setitem(sys.modules, "anthropic", mock_anthropic)
        result = summarize_pull("1 file changed, 2 insertions(+)")
        assert result == "1ファイル更新"

    def test_anthropic_api_error_returns_none(self, monkeypatch):
        from api.ai_summary import summarize_pull
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        mock_anthropic = mock.MagicMock()
        mock_anthropic.AnthropicError = OSError
        mock_anthropic.Anthropic.return_value.messages.create.side_effect = OSError("API error")
        monkeypatch.setitem(sys.modules, "anthropic", mock_anthropic)
        assert summarize_pull("1 file changed") is None
