import { hasPermission } from "@/lib/rbac";
import type { ShareContactType } from "@/schema/contacts";
import { createTRPCRouter, withAccessControl } from "@/trpc/api/trpc";

export const commonRouter = createTRPCRouter({
  // Open to any member (share dialogs), but each half needs the read grant
  // that member.getMembers / stakeholder.getStakeholders need. No policy:
  // withAccessControl only resolves `permissions` here.
  getContacts: withAccessControl.query(async ({ ctx }) => {
    const { db, companyId } = ctx.tenant;
    const contacts = [] as ShareContactType[];
    const can = (subject: "members" | "stakeholder") =>
      hasPermission(ctx.permissions, subject, "read");

    const members = !can("members")
      ? []
      : await db.member.findMany({
          where: {
            companyId,
          },

          include: {
            user: {
              select: {
                email: true,
                name: true,
                image: true,
              },
            },
          },
        });

    const stakeholders = !can("stakeholder")
      ? []
      : await db.stakeholder.findMany({
          where: {
            companyId,
          },
        });
    (members || []).map((member) =>
      contacts.push({
        id: member.id,
        image: member.user.image ?? undefined,
        email: member.user.email ?? "",
        value: member.user.email ?? "",
        name: member.user.name ?? "",
        type: "member",
      }),
    );
    (stakeholders || []).map((stakeholder) =>
      contacts.push({
        id: stakeholder.id,
        email: stakeholder.email,
        value: stakeholder.email,
        name: stakeholder.name,
        institutionName: stakeholder.institutionName ?? undefined,
        type: "stakeholder",
      }),
    );

    return contacts;
  }),
});
