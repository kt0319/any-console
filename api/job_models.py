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
    detached_tab: bool = False
    type: str = "command"
    url: str = ""
    timeout_sec: int | None = None
    # エージェント状態の検知語句（api/agent_watch.py が可視ペインと照合する）。
    # キーは blocked / done、値は部分一致で照合するプレーン文字列のリスト。
    state_patterns: dict[str, list[str]] = field(default_factory=dict)


TERMINAL_JOB_KEY = "terminal"

TERMINAL_JOB = JobDefinition(
    command="",
    label="Terminal",
    description="Open Web Terminal",
)
