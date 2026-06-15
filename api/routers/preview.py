"""Port Preview ルータ。

- `GET /preview/ports` 検出ポート一覧（アクセス時にスキャンを起こす）

検出した dev server は target+20000 の TCP proxy（`api/preview.py`）経由で
`http://<host>:<proxy_port>/` として開く。dev server を素の root origin のまま
出すことで、絶対パス参照や HMR WebSocket をそのまま通す。

セキュリティ:
- proxy の upstream host は 127.0.0.1 にハードコード（`api/preview.py`）。
- 認証は信頼ネットワーク（Tailscale）境界に委ねる。proxy 自体は LISTEN 済みの
  ローカル dev server を tailnet に橋渡しするだけで、新たな到達経路は作らない。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from .. import preview
from ..auth import verify_token

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/preview/ports", dependencies=[Depends(verify_token)])
async def list_detected_ports():
    # パネルを開いた時だけスキャンを起こす（常時ポーリングはしない）。
    preview.touch_access()
    preview.scan_once()
    return preview.list_ports()
