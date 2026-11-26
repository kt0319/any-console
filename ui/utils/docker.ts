// restarting（再起動ループ中）も異常の兆候としてアクティブ扱いにする

const ACTIVE_DOCKER_STATES = ["running", "restarting"] as const;

export function isDockerContainerActive(state?: string | null): boolean {
  return !!state && (ACTIVE_DOCKER_STATES as readonly string[]).includes(state);
}
