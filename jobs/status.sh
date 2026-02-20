#!/bin/bash
set -euo pipefail

echo "=== System Status ==="
echo ""

echo "--- Hostname ---"
hostname

echo ""
echo "--- Uptime ---"
uptime

echo ""
echo "--- Disk Usage ---"
df -h / 2>/dev/null || echo "df not available"

echo ""
echo "--- Memory ---"
free -h 2>/dev/null || vm_stat 2>/dev/null || echo "memory info not available"

echo ""
echo "--- CPU Temperature ---"
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
  temp=$(cat /sys/class/thermal/thermal_zone0/temp)
  echo "$((temp / 1000)).$(( (temp % 1000) / 100 ))°C"
else
  echo "N/A (not running on Raspberry Pi)"
fi

echo ""
echo "Done."
