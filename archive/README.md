# archive/

Frozen reference code from before the field_capture_v2 migration. **Not built, not deployed, not maintained.**

## Contents

- **`ros2-react-app/`** — older SSH-bridged React monitor that talked to the Jetson over `ssh-bridge.js` plus `roslib`. Superseded by `apps/debug-web/`, which talks to `field_capture_v2`'s FastAPI directly. Kept here as historical reference for things like the calibration UI and the topic-publisher UX.

## Removal timeline

This directory will be deleted one release cycle after `field_capture_v2` is verified on production devices and `apps/debug-web/` reaches feature parity for any flows that still need a web UI.
