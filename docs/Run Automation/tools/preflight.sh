#!/bin/bash
# Pre-flight checks before a Basic run (macOS). usage: bash "docs/Run Automation/tools/preflight.sh" <path to main checkout>
M="${1:-/Users/restart/Documents/GitHub/AutoOrchestr}"; T="$(cd "$(dirname "$0")" && pwd)"
echo "1. screen locked?   $(ioreg -n Root -d1 | grep -E 'IOConsoleLocked' | head -1 | tr -d ' ')   (must be = No)"
echo "2. display awake guard: $(pmset -g assertions | grep PreventUserIdleDisplaySleep | head -1 | tr -s ' ')   (must be 1; start: caffeinate -dimsu -t 7200 &)"
echo "3. delivered version (main checkout): $(grep '"version"' "$M/manifest.json" | tr -d ' ,')"
echo "4. panel tab present / version loaded: $(bash "$T/js.sh" "$T/extension-version.js" pipeline_panel.html)   (NO TAB = open the panel; missing value = reload the panel tab)"
echo "5. run state: $(bash "$T/js.sh" "$T/run-state.js" pipeline_panel.html | head -c 160)   (runBtn must not be 'Остановить Basic')"
echo "6. any modal: $(bash "$T/js.sh" "$T/any-modal.js" pipeline_panel.html)   (must be [])"
echo "7. Claude tab: $(bash "$T/js.sh" "$T/claude-page-state.js" claude.ai)   (limit false, composer empty: run claude-composer-state.js)"
echo "8. telemetry window: $(bash "$T/js.sh" "$T/close-devtools-modal.js" pipeline_panel.html)   (closed if it was open)"
