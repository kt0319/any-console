import copy
import logging
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

logger = logging.getLogger(__name__)

try:
    from pydantic import ConfigDict
    _HAS_CONFIG_DICT = True
except ImportError:  # pragma: no cover - Pydantic v1 fallback
    _HAS_CONFIG_DICT = False


class _ConfigModel(BaseModel):
    if _HAS_CONFIG_DICT:
        model_config = ConfigDict(extra="allow")
    else:  # pragma: no cover - Pydantic v1 fallback
        class Config:
            extra = "allow"


class SnippetConfig(_ConfigModel):
    label: str = ""
    command: str


class JobConfig(_ConfigModel):
    command: str = ""
    url: str = ""
    type: str = "command"
    label: str = ""
    description: str = ""
    icon: str = ""
    icon_color: str = ""
    confirm: bool = True
    detached_tab: bool = False
    timeout_sec: int | None = None

    @field_validator("timeout_sec")
    @classmethod
    def _validate_timeout_sec(cls, v):
        if v is None:
            return v
        if not isinstance(v, int) or v < 1:
            raise ValueError("timeout_sec must be a positive integer")
        if v > 86400:
            raise ValueError("timeout_sec must not exceed 86400 (24h)")
        return v

    @model_validator(mode="after")
    def _check_command_or_url(self):
        if self.type == "browser":
            if not self.url:
                raise ValueError("url is required for browser type")
        else:
            if not self.command:
                raise ValueError("command is required")
        return self


class WorkspaceConfig(_ConfigModel):
    name: str = ""
    path: str = ""
    icon: str = ""
    icon_color: str = ""
    hidden: bool = False
    jobs: dict[str, JobConfig] = Field(default_factory=dict)
    worktree: bool = False
    worktree_base: str = ""
    worktree_branch: str = ""


class GlobalConfig(_ConfigModel):
    snippets: list[SnippetConfig] = Field(default_factory=list)
    workspace_order: list[str] = Field(default_factory=list)
    jobs: dict[str, JobConfig] = Field(default_factory=dict)
    host: str = ""
    port: int = 0
    # Tailscale ヘッダ（Tailscale-User-Login）による自動認証の opt-in。
    # デフォルト無効（api/auth.py の SECURITY コメント参照）。反映には再起動が必要。
    trust_tailscale_auth: bool = False


def _model_validate(model_cls: type[BaseModel], data: Any) -> BaseModel:
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(data)
    return model_cls.parse_obj(data)


def _model_dump(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        result = model.model_dump(exclude_defaults=True, exclude_none=True)
    else:
        result = model.dict(exclude_defaults=True, exclude_none=True)
    return dict(result)


def validate_workspace_config(data: Any) -> dict[str, Any]:
    return _model_dump(_model_validate(WorkspaceConfig, data))


def _strip_invalid_global_locations(data: dict[str, Any], exc: ValidationError) -> dict[str, Any]:
    """検証エラーになった該当箇所だけを取り除く（残りのフィールドは保持する）。

    宣言スカラー（port 等）はキーごと削除してデフォルトに委ね、jobs は該当ジョブのみ、
    snippets は該当インデックスのみを落とす。radial 等の extra フィールドは触らない。
    """
    repaired = copy.deepcopy(data)
    snippet_drop: set[int] = set()
    for err in exc.errors():
        loc = err.get("loc", ())
        if not loc or not isinstance(loc[0], str):
            continue
        head = loc[0]
        sub = loc[1] if len(loc) >= 2 else None
        if head == "jobs" and isinstance(sub, str) and isinstance(repaired.get("jobs"), dict):
            repaired["jobs"].pop(sub, None)
        elif head == "snippets" and isinstance(sub, int):
            snippet_drop.add(sub)
        else:
            repaired.pop(head, None)
    if snippet_drop and isinstance(repaired.get("snippets"), list):
        repaired["snippets"] = [s for i, s in enumerate(repaired["snippets"]) if i not in snippet_drop]
    return repaired


def validate_global_config(data: Any) -> dict[str, Any]:
    try:
        return _model_dump(_model_validate(GlobalConfig, data))
    except ValidationError as exc:
        # 不正なフィールドが1つでもあると global セクション全体が破棄され、無関係な
        # radial（サークルキーパッド）や jobs/snippets まで巻き添えでリセットされる。
        # 該当箇所だけ落として残りを救済する。
        if not isinstance(data, dict):
            raise
        repaired = _strip_invalid_global_locations(data, exc)
        result = _model_dump(_model_validate(GlobalConfig, repaired))
        dropped = sorted({str(e.get("loc", ("?",))[0]) for e in exc.errors()})
        logger.warning("global config had invalid entries; dropped fields=%s (other settings preserved)", dropped)
        return result


def validate_config_entry(name: str, data: Any, global_config_key: str) -> dict[str, Any]:
    if name == global_config_key:
        return validate_global_config(data)
    return validate_workspace_config(data)


def normalize_loaded_config(
    raw: Any, global_config_key: str,
) -> tuple[dict[str, Any], list[tuple[str, ValidationError | str]]]:
    if raw is None:
        return {}, []
    if not isinstance(raw, dict):
        return {}, [("__root__", "top-level config must be an object")]

    normalized: dict[str, Any] = {}
    errors: list[tuple[str, ValidationError | str]] = []
    for name, entry in raw.items():
        if not isinstance(name, str):
            errors.append((repr(name), "config key must be a string"))
            continue
        try:
            normalized[name] = validate_config_entry(name, entry, global_config_key)
        except ValidationError as exc:
            errors.append((name, exc))
    return normalized, errors
