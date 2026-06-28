#!/usr/bin/env bash
set -euo pipefail
bun install
( cd apps/ui && bunx vite build )
echo "Built. Run: bun run apps/bridge/src/cli.ts"
