import ViewDigestEmail from "@/emails/ViewDigestEmail";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { describeTarget } from "@/server/activity/describe";
import { UNOPENED_AFTER_DAYS, findUnopened } from "@/server/activity/unopened";
import { db } from "@/server/db";
import { sendMail } from "@/server/mailer";
import { render } from "@react-email/components";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.view-digest",
  schema: z.object({}),
});
export const viewDigestEmailJob = defineJob(config);

const DAY = 86_400_000;

type DigestMember = {
  id: string;
  role: string | null;
  user: { email: string | null };
};

async function digestForCompany(
  companyId: string,
  members: DigestMember[],
  now: Date,
) {
  const since = new Date(now.getTime() - DAY);
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, publicId: true },
  });
  const events = await db.viewEvent.findMany({
    where: { companyId, createdAt: { gte: since }, isBot: false },
    select: {
      kind: true,
      targetId: true,
      recipientId: true,
      activeSeconds: true,
    },
  });
  // waitingSince inside the last (N + 1) days: each recipient is mentioned once,
  // on the day it crosses the line
  const crossing = (await findUnopened(db, companyId, { now })).filter(
    (u) =>
      now.getTime() - u.waitingSince.getTime() <
      (UNOPENED_AFTER_DAYS + 1) * DAY,
  );
  if (!events.length && !crossing.length) return;

  // one row per (kind, target, recipient)
  const rows = new Map<
    string,
    {
      kind: (typeof events)[number]["kind"];
      targetId: string;
      recipientId: string;
      visits: number;
      seconds: number;
    }
  >();
  for (const e of events) {
    const key = `${e.kind}:${e.targetId}:${e.recipientId}`;
    const r = rows.get(key) ?? {
      kind: e.kind,
      targetId: e.targetId,
      recipientId: e.recipientId,
      visits: 0,
      seconds: 0,
    };
    r.visits += 1;
    r.seconds += e.activeSeconds;
    rows.set(key, r);
  }
  // a deleted target is skipped, not fatal
  const described = await Promise.all(
    [...rows.values()].map(async (r) => ({
      r,
      d: await describeTarget({
        companyId,
        kind: r.kind,
        targetId: r.targetId,
        recipientId: r.recipientId,
      }).catch(() => null),
    })),
  );

  for (const m of members) {
    const mine = (owner: string | null) => m.role === "ADMIN" || owner === m.id;
    const viewRows = described.flatMap((x) =>
      x.d && mine(x.d.ownerMemberId)
        ? [
            {
              who: x.d.who,
              label: x.d.label,
              visits: x.r.visits,
              seconds: x.r.seconds,
            },
          ]
        : [],
    );
    const unopened = crossing
      .filter((u) => mine(u.ownerMemberId))
      .map((u) => ({ who: u.name || u.email, label: u.targetName }));
    if (!m.user.email || (!viewRows.length && !unopened.length)) continue;

    await sendMail({
      to: m.user.email,
      subject: `${company.name}: activity in the last 24 hours`,
      html: await render(
        ViewDigestEmail({
          companyName: company.name,
          rows: viewRows,
          unopened,
          link: `${env.NEXT_PUBLIC_BASE_URL}/${company.publicId}/activity`,
        }),
      ),
    });
  }
}

export const viewDigestEmailWorker = defineWorker(config, async () => {
  const now = new Date();
  const digestMembers = await db.member.findMany({
    where: { status: "ACTIVE", notifyOnView: true, viewDigest: true },
    select: {
      id: true,
      role: true,
      companyId: true,
      user: { select: { email: true } },
    },
  });
  const companyIds = [...new Set(digestMembers.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    try {
      await digestForCompany(
        companyId,
        digestMembers.filter((m) => m.companyId === companyId),
        now,
      );
    } catch (error) {
      // one company's failure must not stop the others
      logger
        .child({ module: "queue" })
        .error(`view digest failed for company ${companyId}`, { error });
    }
  }
});
// shortcut: 07:00 UTC for everyone; add a per-member hour when someone asks.
