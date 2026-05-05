// /members — workspace member directory.
//
// One row per active membership in this company. Shows user (email +
// name), role, MFA status, and how long they've been a member. WorkOS
// SSO + invite flow lands as a follow-up — this is the read view + the
// surface that hosts the invite button when the route is wired.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { and, eq, isNull, asc } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema/memberships";
import { users } from "@/lib/db/schema/users";
import { roles } from "@/lib/db/schema/roles";

export const metadata: Metadata = {
  title: "Members · Clipstack",
  description: "Workspace members and their roles.",
};

interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  roleSlug: string;
  roleDisplayName: string;
  grantedAt: Date;
  mfaEnrolled: boolean;
  workosLinked: boolean;
}

async function fetchMembers(): Promise<MemberRow[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  try {
    return await withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          id: memberships.id,
          email: users.email,
          name: users.name,
          roleSlug: roles.slug,
          roleDisplayName: roles.displayName,
          grantedAt: memberships.grantedAt,
          mfaEnrolledAt: users.mfaEnrolledAt,
          workosUserId: users.workosUserId,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(
          and(
            eq(memberships.companyId, companyId),
            // Active memberships only — revoked rows stay in the table for
            // audit but don't surface in the directory.
            isNull(memberships.revokedAt),
          ),
        )
        .orderBy(asc(memberships.grantedAt));

      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        roleSlug: r.roleSlug,
        roleDisplayName: r.roleDisplayName,
        grantedAt: r.grantedAt,
        mfaEnrolled: r.mfaEnrolledAt !== null,
        workosLinked: r.workosUserId !== null,
      }));
    });
  } catch (err) {
    console.error("[members] fetchMembers failed", err);
    return [];
  }
}

function formatGrantedAgo(grantedAt: Date): string {
  const elapsed = Date.now() - grantedAt.getTime();
  const days = Math.max(0, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

const ROLE_TONE: Record<string, "success" | "default" | "warning"> = {
  owner: "success",
  admin: "success",
  member: "default",
  client_guest: "warning",
};

export default async function MembersPage() {
  const members = await fetchMembers();
  const counts = {
    total: members.length,
    mfa: members.filter((m) => m.mfaEnrolled).length,
    workos: members.filter((m) => m.workosLinked).length,
  };

  return (
    <AppShell title="members">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            members
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Everyone with an active seat in this workspace. WorkOS SSO
            handles identity; roles + permissions resolve via the
            membership row.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {counts.total}
            </span>{" "}
            active
          </span>
          {counts.mfa > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-success">
                  {counts.mfa}
                </span>{" "}
                MFA enrolled
              </span>
            </>
          )}
          {counts.workos > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-text-primary">
                  {counts.workos}
                </span>{" "}
                WorkOS-linked
              </span>
            </>
          )}
        </div>

        {members.length === 0 ? (
          <Card size="medium" tone="default">
            <p className="text-sm text-text-secondary leading-relaxed mb-3">
              No active members. The workspace owner gets seeded
              automatically on first login via WorkOS SSO; additional
              seats arrive through the invite flow (parked behind /api/
              invitations).
            </p>
            <p className="text-xs text-text-tertiary">
              Invite-flow spec lands when the SSO-issuer + magic-link
              tokens land. WorkOS Authkit handles the auth handshake.
            </p>
          </Card>
        ) : (
          <ul className="divide-y divide-border-subtle border border-border-subtle rounded-md">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-bg-elevated transition-colors duration-fast"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">
                    {m.name?.trim() || m.email}
                  </div>
                  {m.name && (
                    <div className="text-xs text-text-tertiary font-mono truncate">
                      {m.email}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {m.mfaEnrolled && (
                    <Badge variant="success" className="font-mono text-[10px]">
                      MFA
                    </Badge>
                  )}
                  {m.workosLinked && (
                    <span
                      className="text-[10px] font-mono text-text-tertiary px-1.5 py-0.5 rounded border border-border-subtle"
                      title="Linked to WorkOS identity"
                    >
                      SSO
                    </span>
                  )}
                </div>
                <Badge
                  variant={ROLE_TONE[m.roleSlug] ?? "default"}
                  className="shrink-0"
                  title={m.roleDisplayName}
                >
                  {m.roleSlug}
                </Badge>
                <span className="text-xs text-text-tertiary font-mono tabular-nums shrink-0 w-12 text-right">
                  {formatGrantedAgo(m.grantedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">{members.length} members</span>
          <span aria-hidden>·</span>
          <span>auth: WorkOS Authkit + iron-session</span>
          <span className="md:ml-auto">invite flow · in design</span>
        </div>
      </div>
    </AppShell>
  );
}
