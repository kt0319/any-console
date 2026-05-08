import logging
import os

_logger = logging.getLogger(__name__)

_PULL_PROMPT = (
    "以下は git pull --rebase の出力です。"
    "変更内容を日本語で1行（30字以内）に要約してください。要約のみ出力してください。\n\n"
)


def summarize_pull(stdout: str) -> str | None:
    """git pull stdout を1行に要約する。APIキー未設定・失敗時は None を返す。"""
    if not stdout or "Already up to date" in stdout:
        return None
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError as e:
        _logger.warning("anthropic SDK not available: %s", e)
        return None
    try:
        client = anthropic.Anthropic(api_key=api_key, timeout=8)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=60,
            messages=[{"role": "user", "content": _PULL_PROMPT + stdout[:800]}],
        )
        return msg.content[0].text.strip()
    except (anthropic.AnthropicError, OSError, ValueError, IndexError) as e:
        _logger.warning("ai_summary failed: %s", e)
        return None
