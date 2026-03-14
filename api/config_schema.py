from typing import Any

from pydantic import BaseModel, Field, ValidationError

try:
    from pydantic import ConfigDict
except ImportError:  # pragma: no cover - Pydantic v1 fallback
    ConfigDict = None


if ConfigDict is not None:
    class _ConfigModel(BaseModel):
        model_config = ConfigDict(extra="allow")
else:
    class _ConfigModel(BaseModel):
        class Config:
            extra = "allow"


class SnippetConfig(_ConfigModel):
    label: str = ""
    command: str


class JobConfig(_ConfigModel):
    command: str
    label: str = ""
    description: str = ""
    icon: str = ""
    icon_color: str = ""
    confirm: bool = True
    terminal: bool = True


class WorkspaceConfig(_ConfigModel):
    path: str = ""
    icon: str = ""
    icon_color: str = ""
    hidden: bool = False
    jobs: dict[str, JobConfig] = Field(default_factory=dict)


class GlobalConfig(_ConfigModel):
    snippets: list[SnippetConfig] = Field(default_factory=list)
    workspace_order: list[str] = Field(default_factory=list)


def _model_validate(model_cls: type[BaseModel], data: Any) -> BaseModel:
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(data)
    return model_cls.parse_obj(data)


def _model_dump(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_defaults=True, exclude_none=True)
    return model.dict(exclude_defaults=True, exclude_none=True)


def validate_workspace_config(data: Any) -> dict[str, Any]:
    return _model_dump(_model_validate(WorkspaceConfig, data))


def validate_global_config(data: Any) -> dict[str, Any]:
    return _model_dump(_model_validate(GlobalConfig, data))


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
