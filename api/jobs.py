from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ArgOption:
    name: str
    values: list[str]
    required: bool = True
    dynamic: str | None = None


@dataclass
class JobDefinition:
    script: str
    label: str
    description: str
    args: list[ArgOption] = field(default_factory=list)
    script_path: Path | None = None
    icon: str = ""
    icon_color: str = ""


TERMINAL_JOB = JobDefinition(
    script="",
    label="ターミナル",
    description="Webターミナル起動",
    args=[],
)
