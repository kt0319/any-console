from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class ArgOption:
    name: str
    values: list[str]
    required: bool = True


@dataclass
class JobDefinition:
    script: str
    description: str
    args: list[ArgOption] = field(default_factory=list)

    @property
    def script_path(self) -> Path:
        return PROJECT_ROOT / self.script


JOBS: dict[str, JobDefinition] = {
    "deploy": JobDefinition(
        script="jobs/deploy.sh",
        description="デプロイ実行",
        args=[
            ArgOption(name="env", values=["stg", "prod"], required=True),
            ArgOption(name="service", values=["api", "web"], required=True),
        ],
    ),
    "docker": JobDefinition(
        script="jobs/docker.sh",
        description="Docker操作",
        args=[
            ArgOption(name="action", values=["up", "down", "restart", "logs"], required=True),
            ArgOption(name="service", values=["api", "web", "db"], required=False),
        ],
    ),
    "backup": JobDefinition(
        script="jobs/backup.sh",
        description="バックアップ実行",
        args=[
            ArgOption(name="target", values=["db", "files", "all"], required=True),
        ],
    ),
    "status": JobDefinition(
        script="jobs/status.sh",
        description="システムステータス確認",
        args=[],
    ),
}
