// @ts-check
import { describe, it, expect } from "vitest";
import { reconnectBackoffDelay } from "../../ui/utils/backoff.ts";
import {
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MAX,
  RECONNECT_BACKOFF_MULTIPLIER,
  RECONNECT_INITIAL_DELAY,
} from "../../ui/utils/constants.ts";

describe("reconnectBackoffDelay", () => {
  it("grows exponentially from the base delay", () => {
    expect(reconnectBackoffDelay(0)).toBe(RECONNECT_BACKOFF_BASE_MS);
    expect(reconnectBackoffDelay(1)).toBe(RECONNECT_BACKOFF_BASE_MS * RECONNECT_BACKOFF_MULTIPLIER);
    expect(reconnectBackoffDelay(2)).toBe(RECONNECT_BACKOFF_BASE_MS * RECONNECT_BACKOFF_MULTIPLIER ** 2);
  });

  it("caps at RECONNECT_BACKOFF_MAX", () => {
    expect(reconnectBackoffDelay(10)).toBe(RECONNECT_BACKOFF_MAX);
  });

  it("uses initialDelay for attempt 0 and shifts the exponent afterwards", () => {
    expect(reconnectBackoffDelay(0, { initialDelay: RECONNECT_INITIAL_DELAY })).toBe(RECONNECT_INITIAL_DELAY);
    expect(reconnectBackoffDelay(1, { initialDelay: RECONNECT_INITIAL_DELAY })).toBe(RECONNECT_BACKOFF_BASE_MS);
    expect(reconnectBackoffDelay(2, { initialDelay: RECONNECT_INITIAL_DELAY }))
      .toBe(RECONNECT_BACKOFF_BASE_MS * RECONNECT_BACKOFF_MULTIPLIER);
  });

  it("caps at RECONNECT_BACKOFF_MAX with initialDelay too", () => {
    expect(reconnectBackoffDelay(20, { initialDelay: RECONNECT_INITIAL_DELAY })).toBe(RECONNECT_BACKOFF_MAX);
  });
});
