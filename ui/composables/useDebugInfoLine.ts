import { computed } from "vue";
import { useClientLogs } from "./useClientLogs.ts";
import { useDebugLevels, useDebugMode } from "./useDebugMode.ts";

/** デバッグモード中にタイトルバーへ出す、最新のクライアントログ1行。 */
export function useDebugInfoLine() {
  const debugMode = useDebugMode();
  const { logs: clientLogs, levelLabel } = useClientLogs();
  const debugLevels = useDebugLevels();

  const latestLog = computed(() => {
    for (let i = clientLogs.value.length - 1; i >= 0; i--) {
      if (debugLevels.value.has(clientLogs.value[i].level)) return clientLogs.value[i];
    }
    return null;
  });
  const debugInfo = computed(() => {
    const log = latestLog.value;
    if (!log) return "(no logs yet)";
    const label = log.level === "log" ? "" : `[${levelLabel(log.level)}] `;
    return `${label}${log.msg}`;
  });

  return { debugMode, latestLog, debugInfo };
}
