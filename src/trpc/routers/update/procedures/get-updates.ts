import { encode } from "@/lib/jwt";
import { withAccessControl, withTenant } from "@/trpc/api/trpc";
import { z } from "zod";

export const getUpdatesProcedure = withTenant.query(async ({ ctx }) => {
  const { db, companyId } = ctx.tenant;

  const data = await db.update.findMany({
    where: {
      companyId,
    },
    include: {
      recipients: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return { data };
});

export const getRecipientsProcedure = withAccessControl
  .meta({ policies: { updates: { allow: ["read"] } } })
  .input(z.object({ updateId: z.string() }))
  .query(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;

    const { updateId } = input;

    const data = await db.updateRecipient.findMany({
      where: {
        update: {
          id: updateId,
          companyId: companyId,
        },
      },
    });

    const recipients = await Promise.all(
      data.map(async (recipient) => ({
        ...recipient,
        token: await encode({
          updateId,
          companyId,
          recipientId: recipient.id,
        }),
      })),
    );

    return recipients;
  });
