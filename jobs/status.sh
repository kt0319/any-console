#!/bin/bash
set -euo pipefail

echo "=== System Status ==="
echo ""

echo "--- Working Directory ---"
pwd

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
echo "Done."
