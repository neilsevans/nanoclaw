#!/bin/bash
# NanoClaw log rotation script
# Rotates daily, keeps 7 days of compressed logs

set -e

LOG_DIR="/Users/clawdia/nanoclaw/logs"
KEEP_DAYS=7
TODAY=$(date +%Y%m%d)
ROTATION_LOG="$LOG_DIR/rotation.log"

# Only rotate if logs exist and are not empty
rotate_log() {
  local log_file="$1"

  if [ -f "$log_file" ] && [ -s "$log_file" ]; then
    # Copy and gzip (preserves original for running process)
    gzip -c "$log_file" > "$log_file-$TODAY.gz" 2>/dev/null

    # Truncate original (safe for running processes with copytruncate behavior)
    > "$log_file"

    echo "✓ Rotated $(basename $log_file) → $(basename $log_file)-$TODAY.gz" >> "$ROTATION_LOG"
  fi
}

# Main rotation
echo "=== Log Rotation $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$ROTATION_LOG"

for log in "$LOG_DIR"/*.log; do
  [ -f "$log" ] && rotate_log "$log"
done

# Clean up old logs (>7 days)
OLD_LOGS=$(find "$LOG_DIR" -name "*.log-*.gz" -mtime +$KEEP_DAYS 2>/dev/null || true)
if [ -n "$OLD_LOGS" ]; then
  echo "$OLD_LOGS" | while read old_log; do
    rm -f "$old_log"
    echo "✓ Deleted $(basename $old_log)" >> "$ROTATION_LOG"
  done
else
  echo "✓ No logs older than $KEEP_DAYS days to delete" >> "$ROTATION_LOG"
fi

# Summary
DISK_USAGE=$(du -sh "$LOG_DIR" | awk '{print $1}')
echo "✓ Log directory size: $DISK_USAGE" >> "$ROTATION_LOG"
echo "" >> "$ROTATION_LOG"

exit 0
