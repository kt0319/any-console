from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class ArgOption:
    name: str
    values: list[str]
    required: bool = True
    dynamic: str | None = None  # "branches" など、API経由で値を取得するキー


@dataclass
class JobDefinition:
    script: str
    label: str
    description: str
    args: list[ArgOption] = field(default_factory=list)
    script_path_override: Path | None = None

    @property
    def script_path(self) -> Path:
        if self.script_path_override is not None:
            return self.script_path_override
        return PROJECT_ROOT / self.script


TERMINAL_JOB = JobDefinition(
    script="",
    label="ターミナル",
    description="Webターミナル起動",
    args=[],
)
