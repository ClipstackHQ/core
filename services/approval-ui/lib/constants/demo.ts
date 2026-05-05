// Constants for the seeded demo workspace.
//
// Single source of truth — both the seed script (scripts/seed-demo.ts)
// and the runtime DemoBadge component import from here. The UUIDs are
// intentionally collision-free v4 values that won't collide with real
// production tenants on a self-hosted install (00000000-... prefix is
// reserved for our seed by convention).

/**
 * The deterministic UUID of the seeded "Demo Workspace" tenant.
 * Used by:
 *   - scripts/seed-demo.ts: writes this row + its children
 *   - components/layout/DemoBadge.tsx: surfaces a "DEMO DATA" badge
 *     when the active session is scoped to this tenant
 *   - tests/e2e/*: AUTH_STUB_COMPANY_ID env var sets this on CI runs
 */
export const DEMO_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * The deterministic UUID of the seeded demo user (demo@clipstack.app).
 * Pairs with DEMO_COMPANY_ID via memberships row.
 */
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000002";
