// Dockerコンテナの状態のうち「気づきたい状態」の判定を1箇所に集約する。
// running（正常稼働）に加え、restarting（再起動ループ中 = 異常の兆候）も
// アクティブ扱いにする。paused/exited/dead/createdは対象外。

export const ACTIVE_DOCKER_STATES = ["running", "restarting"] as const;

export function isDockerContainerActive(state?: string | null): boolean {
  return !!state && (ACTIVE_DOCKER_STATES as readonly string[]).includes(state);
}
