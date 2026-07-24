from dataclasses import dataclass


@dataclass
class JobDefinition:
    command: str
    label: str
    icon: str = ""
    icon_color: str = ""
    confirm: bool = True
    detached_tab: bool = False
    type: str = "command"
    url: str = ""
    # 通知フレーズ: 可視ペインにこの文字列が現れたらプッシュ通知を送る。
    notify_phrase: str = ""


TERMINAL_JOB_KEY = "terminal"

TERMINAL_JOB = JobDefinition(
    command="",
    label="Terminal",
)
