import { createSharedResourcePoll } from "./useSharedResourcePoll.ts";
import { EP_PREVIEW_PORTS } from "../utils/endpoints.ts";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.ts";

const usePoll = createSharedResourcePoll({ endpoint: EP_PREVIEW_PORTS, intervalMs: DEV_SERVER_POLL_INTERVAL_MS });

export function usePreviewPorts() {
  const { items, start, stop, fetchItems } = usePoll();
  return { ports: items, start, stop, fetchPorts: fetchItems };
}
