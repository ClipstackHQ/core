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
