#!/usr/bin/env bash
# Enhanced test script for Ctrl+O expansion functionality
set -e

SESSION="omp-ctrl-o-test"
BINARY="./packages/coding-agent/dist/omp"
LOG_DIR="$HOME/.omp/logs"

echo "=== Enhanced Ctrl+O Expansion Test ==="
echo ""

# Clean up any existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create new detached session with larger dimensions
echo "1. Starting OMP in tmux session..."
tmux new-session -d -s "$SESSION" -x 120 -y 50

# Start OMP
tmux send-keys -t "$SESSION" "cd /Volumes/SanDisk1Tb/OhMyFloyd && $BINARY" Enter
sleep 4

# Wait for prompt
echo "2. Waiting for prompt..."
sleep 2

# Execute command that produces long output
echo "3. Executing bash command with long output (seq 1 100)..."
tmux send-keys -t "$SESSION" "bash -c 'seq 1 100'" Enter

# Wait longer for command to complete
echo "4. Waiting for command completion..."
sleep 5

# Capture state BEFORE Ctrl+O
echo "5. Capturing state before Ctrl+O..."
tmux capture-pane -t "$SESSION" -p > /tmp/omp-test-before.txt
echo "   Saved to: /tmp/omp-test-before.txt"

# Count visible numbers
BEFORE_COUNT=$(grep -cE "^[0-9]+$" /tmp/omp-test-before.txt || echo 0)
echo "   Visible numbers before: $BEFORE_COUNT"

# Send Ctrl+O keypress to EXPAND
echo "6. Sending Ctrl+O to EXPAND..."
tmux send-keys -t "$SESSION" C-o
sleep 2

# Capture state AFTER first Ctrl+O (expanded)
echo "7. Capturing state after expansion..."
tmux capture-pane -t "$SESSION" -p > /tmp/omp-test-expanded.txt
echo "   Saved to: /tmp/omp-test-expanded.txt"

EXPANDED_COUNT=$(grep -cE "^[0-9]+$" /tmp/omp-test-expanded.txt || echo 0)
echo "   Visible numbers after expansion: $EXPANDED_COUNT"

# Check if session is still alive
if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "8. ✅ Session alive after expansion"
else
    echo "8. ❌ CRASH DETECTED after first Ctrl+O"
    exit 1
fi

# Send Ctrl+O again to COLLAPSE
echo "9. Sending Ctrl+O to COLLAPSE..."
tmux send-keys -t "$SESSION" C-o
sleep 2

# Capture state after collapse
echo "10. Capturing state after collapse..."
tmux capture-pane -t "$SESSION" -p > /tmp/omp-test-collapsed.txt
echo "    Saved to: /tmp/omp-test-collapsed.txt"

COLLAPSED_COUNT=$(grep -cE "^[0-9]+$" /tmp/omp-test-collapsed.txt || echo 0)
echo "    Visible numbers after collapse: $COLLAPSED_COUNT"

# Check if session is still alive
if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "11. ✅ Session alive after collapse"
else
    echo "11. ❌ CRASH DETECTED after second Ctrl+O"
    exit 1
fi

# Analyze expansion behavior
echo ""
echo "=== Expansion Behavior Analysis ==="
echo "Before Ctrl+O:  $BEFORE_COUNT visible numbers"
echo "After expand:   $EXPANDED_COUNT visible numbers"
echo "After collapse: $COLLAPSED_COUNT visible numbers"

if [ "$EXPANDED_COUNT" -gt "$BEFORE_COUNT" ]; then
    echo "✅ Expansion worked - more lines visible"
elif [ "$EXPANDED_COUNT" -eq "$BEFORE_COUNT" ] && [ "$BEFORE_COUNT" -gt 0 ]; then
    echo "⚠️  Same number of lines visible (may already be fully expanded)"
else
    echo "⚠️  Unable to detect expansion (command may still be running or output not visible)"
fi

if [ "$COLLAPSED_COUNT" -lt "$EXPANDED_COUNT" ]; then
    echo "✅ Collapse worked - fewer lines visible"
elif [ "$COLLAPSED_COUNT" -eq "$BEFORE_COUNT" ]; then
    echo "✅ Collapsed back to original state"
else
    echo "⚠️  Collapse behavior unclear"
fi

# Check logs
echo ""
echo "=== Log Verification ==="
LATEST_LOG=$(ls -t $LOG_DIR/omp.*.log 2>/dev/null | head -1)
if [ -n "$LATEST_LOG" ]; then
    echo "Latest log: $LATEST_LOG"
    
    # Count expansion events
    EXPANSION_COUNT=$(grep -c "TOOL_OUTPUT_EXPANSION_TOGGLED" "$LATEST_LOG" 2>/dev/null || echo 0)
    echo "Found $EXPANSION_COUNT expansion toggle events"
    
    if [ "$EXPANSION_COUNT" -ge 2 ]; then
        echo "✅ Both toggle events logged"
        echo ""
        echo "Last 2 expansion events:"
        grep "TOOL_OUTPUT_EXPANSION_TOGGLED" "$LATEST_LOG" | tail -2
    else
        echo "⚠️  Expected 2 toggle events, found $EXPANSION_COUNT"
    fi
    
    # Check for expansion details
    if grep -q "Tool output expansion toggled" "$LATEST_LOG" 2>/dev/null; then
        echo ""
        echo "Expansion details:"
        grep "Tool output expansion toggled" "$LATEST_LOG" | tail -2
    fi
    
    # Check for errors
    ERROR_COUNT=$(grep -c '"level":"error".*expansion' "$LATEST_LOG" 2>/dev/null || echo 0)
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo ""
        echo "⚠️  Found $ERROR_COUNT errors related to expansion:"
        grep '"level":"error".*expansion' "$LATEST_LOG" | tail -5
    else
        echo ""
        echo "✅ No errors related to expansion"
    fi
fi

# Clean up
echo ""
echo "12. Cleaning up..."
tmux send-keys -t "$SESSION" C-c
sleep 1
tmux send-keys -t "$SESSION" "exit" Enter
sleep 1
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo ""
echo "=== Test Complete ==="
echo ""
echo "Evidence files:"
echo "  - /tmp/omp-test-before.txt     (before expansion)"
echo "  - /tmp/omp-test-expanded.txt   (after Ctrl+O expand)"
echo "  - /tmp/omp-test-collapsed.txt  (after Ctrl+O collapse)"
