#!/bin/bash
# Double-click to start ROBer COP on macOS.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then double-click this file again."
  read -r -p "Press Enter to close." _
  exit 1
fi
node launcher/robercop.mjs "$@"
status=$?
if [ $status -ne 0 ]; then read -r -p "Press Enter to close." _; fi
exit $status
