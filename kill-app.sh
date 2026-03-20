#!/bin/bash
# Kill all running processes for the Exchange App (Linux/Mac)

echo "🛑 Killing all app processes..."

# Kill npm start:all processes
pkill -9 -f "npm run start:all" 2>/dev/null

# Kill vite dev server
pkill -9 -f "vite" 2>/dev/null

# Kill npm processes
pkill -9 -f "npm run" 2>/dev/null

# Kill node processes (be careful - this kills all node processes!)
# pkill -9 node 2>/dev/null

# Kill zig build/run processes
pkill -9 -f "zig build run" 2>/dev/null
pkill -9 -f "zig-exchange-server" 2>/dev/null

sleep 2

# Verify processes are killed
REMAINING=$(ps aux | grep -E "(npm|vite|zig)" | grep -v grep | wc -l)

if [ "$REMAINING" -eq 0 ]; then
  echo "✅ All app processes killed successfully"
  exit 0
else
  echo "⚠️  Still $REMAINING processes running, forcing harder kill..."
  pkill -9 -f "npm" 2>/dev/null
  pkill -9 -f "node.*exchange" 2>/dev/null
  sleep 1
  echo "✅ Force kill complete"
  exit 0
fi
