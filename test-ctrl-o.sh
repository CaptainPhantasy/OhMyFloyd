#!/usr/bin/env bash
# Test script for Ctrl+O expansion functionality
set -e

SESSION="omp-ctrl-o-test"
BINARY="./packages/coding-agent/dist/omp"
LOG_DIR="$HOME/.omp/logs"

echo "=== Ctrl+O Expansion Test ==="
echo ""

# Clean up any existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create new detached session
echo "1. Starting OMP in tmux session..."
tmux new-session -d -s "$SESSION" -x 120 -y 40

# Start OMP
tmux send-keys -t "$SESSION" "cd /Volumes/SanDisk1Tb/OhMyFloyd && $BINARY" Enter
sleep 3

# Wait for prompt (send a newline to ensure we're at prompt)
tmux send-keys -t "$SESSION" "" Enter
sleep 1

# Execute command that produces long output
echo "2. Executing bash command with long output..."
tmux send-keys -t "$SESSION" "bash -c 'seq 1 100'" Enter
sleep 3

# Capture state BEFORE Ctrl+O
echo "3. Capturing state before Ctrl+O..."
tmux capture-pane -t "$SESSION" -p > /tmp/omp-before-ctrl-o.txt
echo "   Saved to: /tmp/omp-before-ctrl-o.txt"

# Send Ctrl+O keypress
echo "4. Sending Ctrl+O keypress..."
tmux send-keys -t "$SESSION" C-o
sleep 2

# Capture state AFTER Ctrl+O
echo "5. Capturing state after Ctrl+O..."
tmux capture-pane -t "$SESSION" -p > /tmp/omp-after-ctrl-o.txt
echo "   Saved to: /tmp/omp-after-ctrl-o.txt"

# Check if session is still alive (crash detection)
if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "6. ✅ Session still alive - no crash detected"
    
    # Send Ctrl+O again to collapse
    echo "7. Sending Ctrl+O again to collapse..."
    tmux send-keys -t "$SESSION" C-o
    sleep 2
    
    tmux capture-pane -t "$SESSION" -p > /tmp/omp-after-second-ctrl-o.txt
    echo "   Saved to: /tmp/omp-after-second-ctrl-o.txt"
    
    # Check again
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        echo "8. ✅ Session still alive after second Ctrl+O - no crash"
    else
        echo "8. ❌ Session crashed after second Ctrl+O"
        exit 1
    fi
else
    echo "6. ❌ Session crashed after first Ctrl+O"
    exit 1
fi

# Check logs for our debug marker
echo ""
echo "9. Checking logs for debug markers..."
LATEST_LOG=$(ls -t $LOG_DIR/omp.*.log 2>/dev/null | head -1)
if [ -n "$LATEST_LOG" ]; then
    echo "   Latest log: $LATEST_LOG"
    if grep -q "TOOL_OUTPUT_EXPANSION_TOGGLED" "$LATEST_LOG" 2>/dev/null; then
        echo "   ✅ Found TOOL_OUTPUT_EXPANSION_TOGGLED marker in logs"
        grep "TOOL_OUTPUT_EXPANSION_TOGGLED" "$LATEST_LOG" | tail -3
    else
        echo "   ⚠️  Debug marker not found in logs"
    fi
    
    if grep -q "Tool output expansion toggled" "$LATEST_LOG" 2>/dev/null; then
        echo "   ✅ Found expansion toggle log message"
        grep "Tool output expansion toggled" "$LATEST_LOG" | tail -3
    else
        echo "   ⚠️  Expansion toggle message not found"
    fi
else
    echo "   ⚠️  No log files found in $LOG_DIR"
fi

# Clean up
echo ""
echo "10. Cleaning up test session..."
tmux send-keys -t "$SESSION" C-c
sleep 1
tmux send-keys -t "$SESSION" "exit" Enter
sleep 1
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo ""
echo "=== Test Complete ==="
echo ""
echo "Evidence files created:"
echo "  - /tmp/omp-before-ctrl-o.txt"
echo "  - /tmp/omp-after-ctrl-o.txt"
echo "  - /tmp/omp-after-second-ctrl-o.txt"
echo ""
echo "Check these files to verify expansion behavior"
