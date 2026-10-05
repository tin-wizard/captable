import type { ShareContactType } from "@/schema/contacts";
import { createTRPCRouter, withTenant } from "@/trpc/api/trpc";

export const commonRouter = createTRPCRouter({
  getContacts: withTenant.query(async ({ ctx }) => {
    const { db, companyId } = ctx.tenant;
    const contacts = [] as ShareContactType[];

    const members = await db.member.findMany({
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

    const stakeholders = await db.stakeholder.findMany({
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
