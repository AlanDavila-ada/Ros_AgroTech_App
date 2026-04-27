#!/bin/bash
#
# Regenerate TypeScript types from the field_capture_v2 OpenAPI schema.
#
# Source priority:
#   1. $OPENAPI_URL  (live API — useful for dev against the running Jetson)
#   2. $DEVICES_HUB_REPO/workspaces/field_capture_v2/openapi.json (default checkout)
#   3. ../../../devices-hub/workspaces/field_capture_v2/openapi.json (sibling repo)
#
# Output: src/data/sources/edge/types.gen.ts
#

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUTPUT="src/data/sources/edge/types.gen.ts"
DEVICES_HUB_REPO="${DEVICES_HUB_REPO:-$HOME/adalabs/devices-hub}"

if [[ -n "${OPENAPI_URL:-}" ]]; then
  SOURCE="$OPENAPI_URL"
elif [[ -f "$DEVICES_HUB_REPO/workspaces/field_capture_v2/openapi.json" ]]; then
  SOURCE="$DEVICES_HUB_REPO/workspaces/field_capture_v2/openapi.json"
elif [[ -f "../../../devices-hub/workspaces/field_capture_v2/openapi.json" ]]; then
  SOURCE="../../../devices-hub/workspaces/field_capture_v2/openapi.json"
else
  echo "error: no OpenAPI source found." >&2
  echo "  set OPENAPI_URL=http://<jetson>:8000/openapi.json, or" >&2
  echo "  set DEVICES_HUB_REPO=<path-to-devices-hub-checkout>, or" >&2
  echo "  check out devices-hub as a sibling of Ros_AgroTech_App." >&2
  exit 1
fi

echo "Regenerating $OUTPUT"
echo "  from: $SOURCE"

mkdir -p "$(dirname "$OUTPUT")"
npx openapi-typescript "$SOURCE" -o "$OUTPUT"

echo "Done."
