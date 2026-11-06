import { describe, it, expect } from "vitest";
import { certExpiryStatus } from "../../ui/utils/cert-expiry.ts";
import { CERT_EXPIRY_WARN_DAYS } from "../../ui/utils/constants.ts";

const NOW_MS = Date.UTC(2026, 10, 6, 0, 0, 0);
const DAY_SEC = 86_400;
const nowSec = NOW_MS / 1000;

describe("certExpiryStatus", () => {
  it("期限まで十分あれば警告しない", () => {
    const s = certExpiryStatus(nowSec + 90 * DAY_SEC, NOW_MS);
    expect(s.warn).toBe(false);
    expect(s.daysLeft).toBe(90);
    expect(s.summary).toBe("2027-02-04 (90 days left)");
  });

  it("警告日数を切ったら警告する（ちょうどの日数は警告しない）", () => {
    expect(certExpiryStatus(nowSec + CERT_EXPIRY_WARN_DAYS * DAY_SEC, NOW_MS).warn).toBe(false);
    expect(certExpiryStatus(nowSec + (CERT_EXPIRY_WARN_DAYS - 1) * DAY_SEC, NOW_MS).warn).toBe(true);
  });

  it("期限切れは警告し、文言に expired を含む", () => {
    const s = certExpiryStatus(nowSec - 1, NOW_MS);
    expect(s.expired).toBe(true);
    expect(s.warn).toBe(true);
    expect(s.summary).toContain("(expired)");
  });

  it("残り1日は単数形で表記する", () => {
    expect(certExpiryStatus(nowSec + DAY_SEC, NOW_MS).summary).toContain("(1 day left)");
  });
});
