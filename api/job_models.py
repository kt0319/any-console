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
    # 一時的に無効化した検知語句。agent_watch.py は参照しない。
    disabled_state_patterns: dict[str, list[str]] = field(default_factory=dict)
    # 統合フレーズリスト（各要素: {phrase: str, icon: str}）。
    # state_patterns より優先される。旧ジョブは空のまま。
    watch_phrases: list[dict] = field(default_factory=list)
    # 一時的に無効化した watch_phrases。agent_watch.py は参照しない。
    watch_phrases_disabled: list[dict] = field(default_factory=list)


TERMINAL_JOB_KEY = "terminal"

TERMINAL_JOB = JobDefinition(
    command="",
    label="Terminal",
    description="Open Web Terminal",
)
