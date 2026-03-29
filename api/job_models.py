from dataclasses import dataclass, field


@dataclass
class ArgOption:
    name: str
    values: list[str]
    required: bool = True
    dynamic: str | None = None


@dataclass
class JobDefinition:
    command: str
    label: str
    description: str
    args: list[ArgOption] = field(default_factory=list)
    icon: str = ""
    icon_color: str = ""
    confirm: bool = True
    terminal: bool = True


TERMINAL_JOB = JobDefinition(
    command="",
    label="Terminal",
    description="Open Web Terminal",
)
