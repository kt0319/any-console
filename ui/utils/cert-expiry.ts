import { CERT_EXPIRY_WARN_DAYS } from "./constants.ts";

const SECONDS_PER_DAY = 86_400;

export type CertExpiryStatus = {
  daysLeft: number;
  expired: boolean;
  warn: boolean;
  dateLabel: string;
  summary: string;
};

/** 証明書の期限（UNIX秒）から、警告要否と表示用の文言を返す。期限切れ・残り日数が警告日数未満なら warn。 */
export function certExpiryStatus(expiresAtSec: number, nowMs: number = Date.now()): CertExpiryStatus {
  const daysLeft = Math.floor((expiresAtSec * 1000 - nowMs) / (SECONDS_PER_DAY * 1000));
  const expired = expiresAtSec * 1000 <= nowMs;
  const dateLabel = new Date(expiresAtSec * 1000).toISOString().slice(0, 10);
  const summary = expired
    ? `${dateLabel} (expired)`
    : `${dateLabel} (${daysLeft} ${daysLeft === 1 ? "day" : "days"} left)`;
  return { daysLeft, expired, warn: expired || daysLeft < CERT_EXPIRY_WARN_DAYS, dateLabel, summary };
}
