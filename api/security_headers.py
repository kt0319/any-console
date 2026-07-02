"""セキュリティ応答ヘッダを全レスポンスに付与するミドルウェア。

任意コマンド実行・Git 操作を提供するコンソールなので、ブラウザ側の
防御層（クリックジャッキング・MIME スニッフィング・リファラ漏洩）を固める。

- X-Frame-Options: DENY — 外部サイトの iframe に埋め込ませない（UI は iframe 不使用）
- X-Content-Type-Options: nosniff — レスポンスの MIME 型推測を禁止
- Referrer-Policy: no-referrer — 外部リンク遷移時に URL を漏らさない

/preview/ 配下はユーザーのアプリを丸ごとプロキシする経路のため対象外とする
（プロキシ先アプリ自身のヘッダ・フレーム利用を壊さない）。
"""

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

SECURITY_HEADERS: dict[str, str] = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}

_SKIP_PREFIXES = ("/preview/",)


def should_skip_security_headers(path: str) -> bool:
    return any(path.startswith(p) for p in _SKIP_PREFIXES)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        if should_skip_security_headers(request.url.path):
            return response
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response
