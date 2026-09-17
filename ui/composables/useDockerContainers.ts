import { createSharedResourcePoll } from "./useSharedResourcePoll.ts";
import { EP_DOCKER_CONTAINERS } from "../utils/endpoints.ts";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.ts";

const usePoll = createSharedResourcePoll({ endpoint: EP_DOCKER_CONTAINERS, intervalMs: DEV_SERVER_POLL_INTERVAL_MS });

export function useDockerContainers() {
  const { items, start, stop, fetchItems } = usePoll();
  return { containers: items, start, stop, fetchContainers: fetchItems };
}
