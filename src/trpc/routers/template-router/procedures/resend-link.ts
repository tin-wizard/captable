import { eSignNotificationEmailJob } from "@/jobs/esign-email";
import { Audit } from "@/server/audit";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { EncodeEmailToken } from "../../template-field-router/procedures/add-fields";
import { ZodResendLinkMutationSchema } from "../schema";

// Signing links expire (LINK_TTL): mint a fresh one for the signer whose turn
// it is and email it with the same job as the original send.
export const resendLinkProcedure = withAccessControl
  .input(ZodResendLinkMutationSchema)
  .meta({ policies: { templates: { allow: ["update"] } } })
  .mutation(async ({ ctx, input }) => {
    const { session, requestIp, userAgent } = ctx;
    const { db, companyId } = ctx.tenant;
    const user = session.user;

    // tenant-scoped: another company's recipient or template is not found
    const recipient = await db.esignRecipient.findFirst({
      where: { id: input.recipientId, templateId: input.templateId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        template: {
          select: {
            id: true,
            name: true,
            status: true,
            message: true,
            company: { select: { name: true, logo: true } },
          },
        },
      },
    });

    if (!recipient) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Recipient not found",
      });
    }

    // SENT is the signer whose turn it is; SIGNED is done, and an ordered
    // recipient still waiting for an earlier signer is PENDING
    const { template } = recipient;
    if (template.status !== "PENDING" || recipient.status !== "SENT") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "A new link can only be sent to the current signer of a document that is out for signature.",
      });
    }

    const token = await EncodeEmailToken({
      recipientId: recipient.id,
      templateId: template.id,
    });

    await Audit.create(
      {
        action: "template.updated",
        companyId,
        actor: { type: "user", id: user.id },
        context: { requestIp, userAgent },
        target: [{ type: "template", id: template.id }],
        summary: `${user.name} resent the signing link for template ID ${
          template.id
        } to ${recipient.name ?? recipient.email}`,
      },
      db,
    );

    await eSignNotificationEmailJob.emit({
      token,
      email: recipient.email,
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
      },
      sender: { name: user.name, email: user.email },
      message: template.message,
      documentName: template.name,
      company: template.company,
      requestIp,
      companyId,
      userAgent,
    });

    return { success: true, message: "A new signing link has been sent." };
  });
