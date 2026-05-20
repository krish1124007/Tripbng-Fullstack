// Repair: link role=AGENCY/SUB_AGENT users that have no `agencyId` to an
// Agency row (where one exists with matching ownerUserId / context).
//
// Why this happens: services/user.service.ts createUser used to silently
// accept `agencyId: null` for role=AGENCY (Phase-13 review fixed the create
// path to reject this — but any user created before that fix is still in
// the DB with the null link). Result: every booking attempt 400s with
// "Bookings require an agency wallet context", and the UI shows the user
// as AGENCY · <userCode> with no obvious signal that anything is wrong.
//
// Detection: User.role IN ('AGENCY', 'SUB_AGENT') AND User.agencyId IS NULL.
//
// Repair strategies (first match wins, per-user):
//   1. Agency.ownerUserId == this user._id   — the canonical link, set
//      automatically by the standard registration flow. If found, this is
//      the agency the user belongs to.
//   2. Agency.tenantId == this user.tenantId AND the user.email matches
//      a contact on the Agency doc — fuzzy fallback for hand-created users
//      that admin attached to an existing agency manually.
//   3. None of the above → report only; admin must pick an agency.
//
// Safety:
//   - Idempotent: only touches users where agencyId is null.
//   - Dry-run by default. Pass `--apply` to actually write.
//   - Per-tenant + per-user log lines.
//
// Usage:
//   pnpm -F @tripbng/api tsx scripts/repairs/2026-05-20-link-orphaned-agency-users.ts
//   pnpm -F @tripbng/api tsx scripts/repairs/2026-05-20-link-orphaned-agency-users.ts --apply
//
// Against a non-default DB (e.g. production):
//   MONGO_URI="mongodb+srv://..." pnpm -F @tripbng/api tsx \
//     scripts/repairs/2026-05-20-link-orphaned-agency-users.ts --apply

import mongoose from 'mongoose';
import { env } from '../../src/config/env.js';
import { logger } from '../../src/config/logger.js';
import { User } from '../../src/models/User.js';
import { Agency } from '../../src/models/Agency.js';

const APPLY = process.argv.includes('--apply');

interface RepairOutcome {
  userId: string;
  email: string;
  userCode: string;
  tenantId: string;
  resolved: 'owner-match' | 'email-match' | 'unresolved';
  agencyId: string | null;
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info(
    { apply: APPLY, mongoUri: env.MONGO_URI.replace(/:[^@:]+@/, ':***@') },
    `Starting orphaned-agency-user repair${APPLY ? ' (APPLY)' : ' (DRY RUN)'}`,
  );

  const orphans = await User.find({
    role: { $in: ['AGENCY', 'SUB_AGENT'] },
    $or: [{ agencyId: null }, { agencyId: { $exists: false } }],
  })
    .select('_id email userCode role tenantId')
    .lean();

  logger.info({ count: orphans.length }, 'orphaned users found');

  const outcomes: RepairOutcome[] = [];

  for (const user of orphans) {
    // Strategy 1: Agency.ownerUserId match — the canonical link.
    const ownerAgency = await Agency.findOne({ ownerUserId: user._id })
      .select('_id agencyCode companyName')
      .lean();

    if (ownerAgency) {
      outcomes.push({
        userId: String(user._id),
        email: user.email,
        userCode: user.userCode,
        tenantId: String(user.tenantId),
        resolved: 'owner-match',
        agencyId: String(ownerAgency._id),
      });
      if (APPLY) {
        await User.updateOne({ _id: user._id }, { $set: { agencyId: ownerAgency._id } });
      }
      logger.info(
        {
          user: user.email,
          userCode: user.userCode,
          agency: ownerAgency.agencyCode,
          agencyId: String(ownerAgency._id),
          applied: APPLY,
        },
        'linked via owner-match',
      );
      continue;
    }

    // Strategy 2: tenant + email substring match. Last-ditch — we look at
    // every Agency in the user's tenant and see if any contact field
    // includes the user's email. Quite fuzzy; only useful as a hint.
    const tenantAgencies = await Agency.find({ tenantId: user.tenantId })
      .select('_id agencyCode companyName ownerUserId')
      .lean();
    const localPart = user.email.split('@')[0]?.toLowerCase() ?? '';
    const guess = localPart && localPart.length > 3
      ? tenantAgencies.find(
          (a) =>
            a.companyName?.toLowerCase().includes(localPart) ||
            a.agencyCode?.toLowerCase().includes(localPart),
        )
      : undefined;

    if (guess) {
      outcomes.push({
        userId: String(user._id),
        email: user.email,
        userCode: user.userCode,
        tenantId: String(user.tenantId),
        resolved: 'email-match',
        agencyId: String(guess._id),
      });
      // Email-match is a GUESS — never auto-apply, just report it.
      logger.warn(
        {
          user: user.email,
          userCode: user.userCode,
          guessedAgency: guess.agencyCode,
          guessedAgencyId: String(guess._id),
        },
        'fuzzy email-match found — manual review required, NOT auto-applied',
      );
      continue;
    }

    outcomes.push({
      userId: String(user._id),
      email: user.email,
      userCode: user.userCode,
      tenantId: String(user.tenantId),
      resolved: 'unresolved',
      agencyId: null,
    });
    logger.error(
      { user: user.email, userCode: user.userCode, tenantId: String(user.tenantId) },
      'unresolved — no Agency.ownerUserId match. Set agencyId manually:',
    );
  }

  // Summary table.
  const byOutcome = outcomes.reduce(
    (acc, o) => {
      acc[o.resolved] = (acc[o.resolved] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  logger.info({ ...byOutcome, total: outcomes.length, applied: APPLY }, 'repair complete');

  if (!APPLY && (byOutcome['owner-match'] ?? 0) > 0) {
    logger.info(
      `Re-run with --apply to actually write the ${byOutcome['owner-match']} owner-matched fixes.`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'repair script failed');
  process.exit(1);
});
