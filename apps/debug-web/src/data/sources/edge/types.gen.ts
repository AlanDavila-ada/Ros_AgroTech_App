/**
 * Placeholder for the OpenAPI-generated TypeScript types.
 *
 * Real types are produced by `npm run codegen` (which runs
 * `apps/debug-web/scripts/codegen.sh`) against either:
 *   - $OPENAPI_URL  (live API), or
 *   - $DEVICES_HUB_REPO/workspaces/field_capture_v2/openapi.json (committed
 *     snapshot in the devices-hub repo).
 *
 * Once codegen runs, this file is overwritten with the real `paths` and
 * `components` types from `openapi-typescript`. The placeholder shipped with
 * Phase F lets the workspace typecheck cleanly out of the box.
 */

export type paths = Record<string, unknown>;
export type components = { schemas: Record<string, unknown> };
export type operations = Record<string, unknown>;

export type SchemaRef<K extends keyof components["schemas"]> = components["schemas"][K];
