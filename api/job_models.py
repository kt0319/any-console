from dataclasses import dataclass


@dataclass
class JobDefinition:
    command: str
    label: str
    description: str
    icon: str = ""
    icon_color: str = ""
    confirm: bool = True
    detached_tab: bool = False
    type: str = "command"
    url: str = ""
    # 通知フレーズ: 可視ペインにこの文字列が現れたらプッシュ通知を送る。
    notify_phrase: str = ""
    # output 変化（working 状態）の検知を有効にするか。False にすると working を返さない。
    working_enabled: bool = True


TERMINAL_JOB_KEY = "terminal"

TERMINAL_JOB = JobDefinition(
    command="",
    label="Terminal",
    description="Open Web Terminal",
)
