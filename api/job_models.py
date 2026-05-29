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
    hidden_tab: bool = False
    type: str = "command"
    url: str = ""
    timeout_sec: int | None = None


TERMINAL_JOB_KEY = "terminal"

TERMINAL_JOB = JobDefinition(
    command="",
    label="Terminal",
    description="Open Web Terminal",
)

AI_AGENT_JOB_KEY = "ai-agent"

AI_AGENT_JOB = JobDefinition(
    command="",
    label="AI Agent",
    description="Launch an AI agent in a Web Terminal",
)
