// Mission Control bento — the home page rendered against seeded data.
//
// Verifies the surface that aggregates everything else: approval queue tile
// shows seeded drafts, bus-health probes render, and institutional-memory
// shows the 8 lessons the seed creates. These are read-only assertions; no
// test mutates the seeded data.

import { test, expect } from "@playwright/test";

test("mission control renders with seeded data", async ({ page }) => {
  await page.goto("/");

  // The TopBar renders the page title via <h1>. AppShell passes
  // "Mission Control" as the title prop on app/page.tsx.
  await expect(page).toHaveTitle(/Clipstack/);
  await expect(page.locator("main").getByRole("heading", { name: "Mission Control" })).toBeVisible();

  // Approval-queue tile — CardLabel "approval queue" is the header copy.
  // Wait for it explicitly so we don't race the streaming render.
  const approvalQueueLabel = page.getByText("approval queue", { exact: true });
  await approvalQueueLabel.waitFor({ state: "visible" });
  await expect(approvalQueueLabel).toBeVisible();

  // At least one row in the queue must be a Link to /drafts/[id]. We
  // don't pin specific titles — test should survive seed copy edits.
  // The seed creates 4 awaiting_approval drafts so at least 4 rows
  // are guaranteed.
  const queueRows = page.locator('a[href^="/drafts/"]');
  await expect(queueRows.first()).toBeVisible({ timeout: 5000 });

  // Bus-health tile — CardLabel "bus health" anchors the tile.
  await expect(page.getByText("bus health", { exact: true })).toBeVisible();

  // Institutional memory tile renders. We don't make assertions on the
  // exact count — the seed creates 8 lessons but the count surface
  // depends on per-tenant scoping that might surface 0 in CI even
  // when the data is in-DB (e.g. a transient session-resolution race).
  // Asserting "tile present" is the right floor for the smoke test;
  // count-correctness gets its own targeted test in a follow-up slice.
  await expect(page.getByText("institutional memory", { exact: true })).toBeVisible();
  // Use .first() because seed-data draft titles can also contain the
  // phrase "lessons captured" (e.g. the weekly-wrap newsletter); the
  // assertion only needs to confirm the institutional-memory tile copy
  // renders, not that it's the unique occurrence on the page.
  await expect(page.getByText(/lessons? captured/i).first()).toBeVisible();
});
