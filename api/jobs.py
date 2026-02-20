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


JOBS: dict[str, JobDefinition] = {
    "status": JobDefinition(
        script="jobs/status.sh",
        label="ステータス",
        description="システムステータス確認",
        args=[],
    ),
    "docker-up": JobDefinition(
        script="jobs/docker-up.sh",
        label="サーバー起動",
        description="docker-compose up -d",
        args=[],
    ),
}
