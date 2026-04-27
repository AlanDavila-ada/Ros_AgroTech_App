# Ros_AgroTech_App

AgroTech client and tooling repo. The Jetson recording engine lives in [`adalabs-ai/devices-hub`](https://github.com/adalabs-ai/devices-hub) under `workspaces/field_capture_v2/` — this repo is for the React debug/admin UI and any prototype scripts that aren't yet part of the device service.

## Status

- **`mobile-hub`** is the primary client for the Jetson FastAPI on `:8000`.
- **`apps/debug-web`** (this repo) is a small debug UI: connect to a Jetson, see live status over WebSocket, browse the event log, trigger start/stop recordings.
- The legacy SSH-bridged React monitor (`ros2-react-app/`) and the Node.js bridge that ran on the Jetson (`jetson-app/server.js`) are deprecated. They're kept under `archive/` for reference and will be removed after a release cycle.

## Quick start

```bash
# Install workspaces
npm install

# Regenerate TS types from the live FastAPI OpenAPI snapshot in devices-hub
npm run codegen

# Start the debug web client (Vite dev server)
npm run dev
# open http://localhost:5173
```

The default edge endpoint is `http://10.42.0.1:8000` (matches `mobile-hub`'s `EDGE_DEFAULT_HOST`/`EDGE_DEFAULT_PORT`). You can change it from the connect screen.

## Architecture

```
Ros_AgroTech_App/
├── apps/
│   └── debug-web/                # Vite + React + TS, clean-arch layers
│       └── src/
│           ├── domain/           # entities, repository contracts (framework-agnostic)
│           ├── data/             # api client, mappers, repository impls
│           │   └── sources/edge/ # field_capture_v2 client + generated types
│           ├── infrastructure/   # http-client, ws-client, config
│           │   ├── network/
│           │   ├── ros/          # roslib wrapper for raw debug topic views
│           │   └── config/
│           ├── presentation/     # components, hooks, stores (Zustand)
│           └── shared/           # constants, utils
├── archive/                      # frozen reference; not built or deployed
│   └── ros2-react-app/           # older SSH-bridged monitor, kept for reference
├── jetson-app/                   # legacy Node bridge + CRA UI (deprecated, .deprecated suffix)
├── package.json                  # npm workspaces root
├── tsconfig.base.json            # shared TS config
├── eslint.config.mjs             # flat ESLint config (mirrors mobile-hub)
└── README.md
```

The clean-arch layers and conventions mirror [`mobile-hub`](../mobile-hub/) so screens that exist in both can share patterns:

- **Domain** — `Patrol`, `Recording`, `Event` entities; repository interfaces. Pure types/values.
- **Data** — `EdgeApiClient` calls FastAPI; mappers DTO→entity; repos implement the domain interfaces.
- **Infrastructure** — `createHttpClient(baseURL)` wraps axios with interceptors; `createWebSocketClient(url)` for live state; `roslib` for raw ROS2 debug subscriptions.
- **Presentation** — Zustand stores (`connection`, `recording`, `events`); custom hooks (`useDeviceConnection`, `useRecordingStatus`, `useEventLogger`); components.

## OpenAPI codegen

The committed `openapi.json` lives in `adalabs-ai/devices-hub` at `workspaces/field_capture_v2/openapi.json`. Our `apps/debug-web/scripts/codegen.sh` runs `openapi-typescript` against either:

1. A local checkout of `devices-hub` (default: `~/adalabs/devices-hub`), or
2. A live API: `OPENAPI_URL=http://10.42.0.1:8000/openapi.json npm run codegen`

Output: `apps/debug-web/src/data/sources/edge/types.gen.ts` (gitignored from lint, source-of-truth for DTOs).

## Migration

This repo's role shrank dramatically when the Jetson backend moved to `field_capture_v2`. The full migration plan lives at `~/.claude/plans/my-jetson-running-the-curried-curry.md`. Phases:

- [x] B–E in `devices-hub` — flagship Python workspace + ROS2 engine + tests + CI + OpenAPI snapshot
- [x] **F (this repo) — TS clean-arch debug client + archive/deprecate legacy code**
- [ ] G — on-Jetson cutover smoke test
