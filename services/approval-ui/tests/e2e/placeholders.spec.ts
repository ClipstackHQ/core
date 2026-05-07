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

test("/calendar surfaces the approve-week wedge button with seeded pending count", async ({
  page,
}) => {
  await page.goto("/calendar");
  // The seed creates 6 awaiting_approval drafts with scheduledAt in the
  // next 7 days. The ApproveWeekButton renders pendingCount=6.
  await expect(page.getByText("Approve next week", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve \d+ drafts/i })).toBeVisible();
});

test("/digest renders the 'your week in 60 seconds' surface with seeded aggregations", async ({
  page,
}) => {
  await page.goto("/digest");
  await expect(
    page.locator("main").getByRole("heading", { name: /your week in 60 seconds/i, level: 1 }),
  ).toBeVisible();
  // Headline number-strip cards anchor with their CardLabels.
  await expect(page.getByText("drafts shipped", { exact: true })).toBeVisible();
  await expect(page.getByText("lessons captured", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("decisions made", { exact: true })).toBeVisible();
  await expect(page.getByText("anomalies", { exact: true })).toBeVisible();
  // Right rail: render-as-video CTA
  await expect(page.getByText("render as 60s video", { exact: true })).toBeVisible();
  // Right rail: Managed-Agents narrate surface. CI doesn't set the MA
  // env vars (the agent + environment are real billable resources, not
  // a CI-time concern), so the NarrateButton renders its unconfigured
  // explainer state. Asserting the copy keeps both states honest — if
  // the surface accidentally goes missing the text vanishes.
  await expect(page.getByText("Mira-narrated digest", { exact: true })).toBeVisible();
});

test("/workspace surfaces the brand-in-at-nine importer with seeded brand kit", async ({
  page,
}) => {
  await page.goto("/workspace");
  // The importer card anchors with its "brand in at nine" CardLabel.
  await expect(page.getByText("brand in at nine", { exact: true })).toBeVisible();
  // Seeded brand kit shows "current kit" + the imported source URL.
  await expect(page.getByText("current kit", { exact: true })).toBeVisible();
  await expect(page.getByText(/imported from/i)).toBeVisible();
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

test("/studio renders adapter catalogue + jobs across all sources", async ({
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
  // Cost-policy table now reads from describeAdapters() — every wired
  // adapter surfaces by its providerName. Sentinel checks for the
  // FREE row anchor (Satori is alphabetically first FREE) + the
  // METERED row anchor (Higgsfield as the "key unlock" provider).
  await expect(page.getByText(/Clipstack Satori/i).first()).toBeVisible();
  await expect(page.getByText(/Higgsfield Mix/i).first()).toBeVisible();
  await expect(page.getByText("FREE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("METERED", { exact: true }).first()).toBeVisible();
  // Seeded jobs render across multiple sources — sentinel: the 47% YoY
  // headline is the title of the first Hyperframes complete artifact.
  await expect(page.getByText(/47% YoY/i)).toBeVisible();
});
