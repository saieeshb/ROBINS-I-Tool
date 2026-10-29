#!/bin/sh
# Starts ROBer COP on Linux.
cd "$(dirname "$0")" || exit 1
exec node launcher/robercop.mjs "$@"
