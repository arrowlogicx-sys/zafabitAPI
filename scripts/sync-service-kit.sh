#!/usr/bin/env bash
# Re-sync the vendored @zafabit/service-kit copy into every consuming service.
#
# Source of truth is the zafabit-service-kit repo. This copies from a local
# checkout (services/shared by default, or $SERVICE_KIT_SRC) into
# services/<svc>/vendor/service-kit so each service repo stays self-contained
# (no private git/registry auth needed to `npm install` or `docker build`).
#
# Usage:
#   ./scripts/sync-service-kit.sh                 # from services/shared
#   SERVICE_KIT_SRC=/path/to/zafabit-service-kit ./scripts/sync-service-kit.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SERVICE_KIT_SRC:-$ROOT/services/shared}"
CONSUMERS=(admin-bff auth booking-engine dispatch-matching identity-profiles maid payments service-catalogue support-trust)

[ -d "$SRC/src" ] || { echo "service-kit source not found at $SRC (set SERVICE_KIT_SRC)"; exit 1; }
TAG="$(git -C "$SRC" describe --tags --always 2>/dev/null || echo unknown)"

for svc in "${CONSUMERS[@]}"; do
  dest="$ROOT/services/$svc/vendor/service-kit"
  mkdir -p "$dest"
  rsync -a --delete \
    --exclude node_modules --exclude test --exclude 'jest.config.js' --exclude '.git' --exclude 'README.md' \
    "$SRC/src" "$SRC/package.json" "$dest/"
  cat > "$dest/VENDORED.md" <<EOF
# Vendored copy of @zafabit/service-kit

Do **not** edit here. Source of truth: https://github.com/CTO-ARROWLOGICX/zafabit-service-kit
Re-sync with: \`./scripts/sync-service-kit.sh\` from the repo root.
Vendored from: $TAG
EOF
  echo "synced -> services/$svc/vendor/service-kit ($TAG)"
done

echo
echo "Now, in each service: npm install && npm test, commit the vendor/ change."
