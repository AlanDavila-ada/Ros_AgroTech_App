# jetson-app — DEPRECATED

This directory is the legacy Node.js + Create-React-App stack that ran on the Jetson before the `field_capture_v2` migration. It is no longer the source of truth.

## What replaced what

| Was here | Now lives in |
|---|---|
| `server.js` (Node 4500-port bridge) | [`adalabs-ai/devices-hub`](https://github.com/adalabs-ai/devices-hub) → `workspaces/field_capture_v2/src/field_capture_v2/api/server.py` (FastAPI on :8000) |
| `deploy/systemd/agrotech-*.service` | `devices-hub/workspaces/field_capture_v2/deployment/field-capture-v2-*.service` |
| `scripts/{mcap_recorder,camera_node,agrotech_log}.py` | `devices-hub/workspaces/field_capture_v2/scripts/ros2/` |
| `src/api.js`, `src/apiSsh.js` (with hardcoded `ada123` SSH password) | `apps/debug-web/src/data/sources/edge/edge-api.client.ts` (no SSH, FastAPI only) |
| `src/components/*.js` (CRA + JS) | `apps/debug-web/src/presentation/{components,hooks,stores}/*.tsx` (Vite + TS + clean-arch) |
| `src/hooks/{useEventLogger,useRecordingStatus}.js` | `apps/debug-web/src/presentation/hooks/{useEventLogger,useRecordingStatus}.ts` |

Files renamed with `.deprecated` suffix in this directory:

- `server.js.deprecated`
- `src/api.js.deprecated`
- `deploy.deprecated/`
- `scripts.deprecated/`

These are kept staged (not deleted) so we can verify v2 on the Jetson before the final cleanup. Once the cutover smoke-test (Phase G) passes, the entire `jetson-app/` directory will be removed.

## Why the rename instead of immediate delete

- The `.deprecated` suffix makes the staging visible in git diffs.
- The remaining `.js` files (`App.js`, components, hooks) are kept as reference while we wire up Phase G; they're not built.
