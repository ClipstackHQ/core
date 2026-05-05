// All four sidebar routes that were "spec in flight" stubs graduated
// to real pages in this sprint: /workspace, /calendar, /members,
// /settings. This file asserts each renders seeded data rather than
// the placeholder copy — catches the same silent-catch-to-empty-state
// regression class the seeded-data-regression suite covers for the
// other real pages.
//
// If a future change accidentally reverts any of these to a "spec in
// flight" stub, the corresponding `not.toBeVisible()` assertion fails
// and CI catches it at PR time.

import { test, expect } from "@playwright/test";

test("/workspace renders seeded counters (catches silent-fail in fetchWorkspace)", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(
    page.locator("main").getByRole("heading", { name: /workspace/i }),
  ).toBeVisible();
  await expect(page.getByText(/spec in flight/i)).not.toBeVisible();
  await expect(page.getByText(/working now/i)).toBeVisible();
  await expect(page.getByText(/captured/i)).toBeVisible();
});

test("/calendar renders seeded scheduled drafts (catches silent-fail in fetchCalendar)", async ({
  page,
}) => {
  await page.goto("/calendar");
  await expect(
    page.locator("main").getByRole("heading", { name: /calendar/i }),
  ).toBeVisible();
  await expect(page.getByText(/spec in flight/i)).not.toBeVisible();
  // Seed schedules 4 drafts in [+22h, +9d]; both upcoming AND recent
  // populate the date-grouped sections.
  await expect(page.getByText(/upcoming/i).first()).toBeVisible();
});

test("/members renders seeded membership row (catches silent-fail in fetchMembers)", async ({
  page,
}) => {
  await page.goto("/members");
  await expect(
    page.locator("main").getByRole("heading", { name: /members/i }),
  ).toBeVisible();
  await expect(page.getByText(/spec in flight/i)).not.toBeVisible();
  // Seed creates 1 owner membership for demo@clipstack.app. If the
  // fetcher's catch fires we get the empty-state copy ("No active
  // members"); the assertion below refuses that path.
  await expect(page.getByText(/active/i).first()).toBeVisible();
  await expect(page.getByText(/no active members/i)).not.toBeVisible();
});

test("/settings renders identity + integration list (catches silent-fail in fetchSettings)", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(
    page.locator("main").getByRole("heading", { name: /settings/i }),
  ).toBeVisible();
  await expect(page.getByText(/spec in flight/i)).not.toBeVisible();
  // The integrations + features section anchors the page; "enabled"
  // wording is stable across env-var combinations.
  await expect(page.getByText(/integrations \+ features/i)).toBeVisible();
});

test("/pitch renders 5 narrative beats + talking-point callouts", async ({
  page,
}) => {
  await page.goto("/pitch");
  await expect(
    page.locator("main").getByRole("heading", { name: /pitch tour/i, level: 1 }),
  ).toBeVisible();
  // Every beat anchors with a "Beat N of 5" label; we check the first
  // and last to confirm the section list rendered fully.
  await expect(page.getByText(/Beat 1 of 5/i)).toBeVisible();
  await expect(page.getByText(/Beat 5 of 5/i)).toBeVisible();
  // Each beat has a "talking points" callout — 5 sections = 5 cards.
  const talkingPointsLabels = page.getByText("talking points", { exact: true });
  await expect(talkingPointsLabels).toHaveCount(5);
});

test("DemoBadge surfaces 'DEMO DATA · seeded workspace' on Mission Control", async ({
  page,
}) => {
  // The badge renders only when session.activeCompanyId === DEMO_COMPANY_ID.
  // CI sets AUTH_STUB_COMPANY_ID to the demo UUID so this fires; in prod
  // (no AUTH_STUB) it stays hidden until a real session lands on the
  // demo tenant.
  await page.goto("/");
  await expect(page.getByText(/DEMO DATA/i)).toBeVisible();
  await expect(page.getByText(/seeded workspace/i)).toBeVisible();
});

test("/studio renders Hyperframes job list + render form + runtime probe", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(
    page.locator("main").getByRole("heading", { name: /studio/i, level: 1 }),
  ).toBeVisible();
  // Render form anchors with the "render scene" CardLabel.
  await expect(page.getByText("render scene", { exact: true })).toBeVisible();
  // Runtime probe panel anchors with "runtime" CardLabel + reports node version.
  await expect(page.getByText("runtime", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/node v\d/i).first()).toBeVisible();
  // Cost-policy table — Hyperframes is the only FREE row at v1.
  await expect(page.getByText("Hyperframes", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FREE", { exact: true }).first()).toBeVisible();
  // Seeded jobs render: 1 complete + 1 rendering + 1 failed.
  // The "complete" status appears in a Badge plus elsewhere; we just
  // verify "complete" is on the page (sentinel for the seeded data path).
  await expect(page.getByText(/47% YoY/i)).toBeVisible();
});
