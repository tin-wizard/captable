import { generatePublicId } from "@/common/id";
import { shareDataRoomEmailJob } from "@/jobs/share-data-room-email";
import { encode } from "@/lib/jwt";
import { ShareRecipientSchema } from "@/schema/contacts";
import { expiryFromDays } from "@/server/activity/link-state";
import { sendReminder, throwIfRefused } from "@/server/activity/send-reminder";
import { Audit } from "@/server/audit";
import { companyUrl } from "@/server/domains/links";
import { assertTenantOwns } from "@/server/tenant-guard";
import { createTRPCRouter, withAccessControl } from "@/trpc/api/trpc";
import type { DataRoom } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DataRoomSchema } from "./schema";

export const dataRoomRouter = createTRPCRouter({
  getDataRoom: withAccessControl
    .meta({ policies: { "data-rooms": { allow: ["read"] } } })
    .input(
      z.object({
        dataRoomPublicId: z.string(),
        include: z.object({
          company: z.boolean().optional().default(false),
          documents: z.boolean().optional().default(false),
          recipients: z.boolean().optional().default(false),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const response = {
        dataRoom: {},
        documents: [],
        recipients: [],
        company: {},
      } as {
        dataRoom: object;
        documents: object[];
        recipients: object[];
        company: object;
      };

      const { db, companyId } = ctx.tenant;
      const { dataRoomPublicId, include } = input;

      const { dataRoom } = await db.$transaction(async (tx) => {
        const dataRoom = await tx.dataRoom.findUniqueOrThrow({
          where: {
            publicId: dataRoomPublicId,
            companyId,
          },
          include: {
            documents: include.documents,
            company: include.company,
            recipients: include.recipients,
          },
        });

        response.dataRoom = dataRoom;

        if (include.documents) {
          const documentIds = dataRoom.documents.map((doc) => doc.id);

          const dataRoomDocument = await tx.dataRoomDocument.findMany({
            where: {
              id: { in: documentIds },
            },

            include: {
              document: {
                select: {
                  id: true,
                  bucket: true,
                },
              },
            },
          });

          response.documents = dataRoomDocument.map((doc) => ({
            id: doc.document.bucket.id,
            name: doc.document.bucket.name,
            key: doc.document.bucket.key,
            mimeType: doc.document.bucket.mimeType,
            size: doc.document.bucket.size,
            createdAt: doc.document.bucket.createdAt,
            updatedAt: doc.document.bucket.updatedAt,
          }));
        }

        if (include.recipients) {
          response.recipients = await Promise.all(
            dataRoom.recipients.map(async (recipient) => ({
              ...recipient,
              token: await encode({
                companyId,
                dataRoomId: dataRoom.id,
                recipientId: recipient.id,
              }),
            })),
          );
        }

        return { dataRoom };
      });

      if (include.company) {
        response.company = dataRoom.company;
      }

      return response;
    }),

  save: withAccessControl
    .input(DataRoomSchema)
    .meta({ policies: { "data-rooms": { allow: ["create", "update"] } } })
    .mutation(async ({ ctx, input }) => {
      try {
        let room = {} as DataRoom;
        const { session, userAgent, requestIp } = ctx;
        const { db, companyId } = ctx.tenant;

        const { publicId } = input;

        await db.$transaction(async (tx) => {
          const { user } = session;
          if (!publicId) {
            room = await tx.dataRoom.create({
              data: {
                name: input.name,
                companyId,
                publicId: generatePublicId(),
                createdById: ctx.tenant.memberId,
              },
            });

            await Audit.create(
              {
                action: "dataroom.created",
                companyId: user.companyId,
                actor: { type: "user", id: user.id },
                context: {
                  userAgent,
                  requestIp,
                },
                target: [{ type: "dataroom", id: room.id }],
                summary: `${user.name} created the data room ${room.name}`,
              },
              tx,
            );
          } else {
            room = await tx.dataRoom.update({
              where: {
                publicId,
                companyId,
              },
              data: {
                name: input.name,
              },
            });

            await Audit.create(
              {
                action: "dataroom.updated",
                companyId: user.companyId,
                actor: { type: "user", id: user.id },
                context: {
                  userAgent,
                  requestIp,
                },
                target: [{ type: "dataroom", id: room.id }],
                summary: `${user.name} updated the data room ${room.name}`,
              },
              tx,
            );

            const { documents, recipients } = input;

            // every referenced document/member/stakeholder must belong to this company
            if (documents?.length) {
              const ids = [...new Set(documents.map((d) => d.documentId))];
              const owned = await tx.document.count({
                where: { id: { in: ids }, companyId },
              });
              if (owned !== ids.length) throw new Error("Invalid document");
            }
            const memberIds = [
              ...new Set(recipients?.flatMap((r) => r.memberId ?? []) ?? []),
            ];
            if (memberIds.length) {
              const owned = await tx.member.count({
                where: { id: { in: memberIds }, companyId },
              });
              if (owned !== memberIds.length) throw new Error("Invalid member");
            }
            const stakeholderIds = [
              ...new Set(
                recipients?.flatMap((r) => r.stakeholderId ?? []) ?? [],
              ),
            ];
            if (stakeholderIds.length) {
              const owned = await tx.stakeholder.count({
                where: { id: { in: stakeholderIds }, companyId },
              });
              if (owned !== stakeholderIds.length)
                throw new Error("Invalid stakeholder");
            }

            if (documents) {
              await tx.dataRoomDocument.createMany({
                data: documents.map((document) => ({
                  dataRoomId: room.id,
                  documentId: document.documentId,
                })),
              });
            }

            if (recipients) {
              await tx.dataRoomRecipient.createMany({
                data: recipients.map((recipient) => ({
                  dataRoomId: room.id,
                  email: recipient.email,
                  memberId: recipient.memberId,
                  stakeholderId: recipient.stakeholderId,
                })),
              });
            }
          }
        });

        return {
          success: true,
          message: "Successfully updated data room",
          data: room,
        };
      } catch (error) {
        console.error(error);
        return {
          success: false,
          message:
            "Oops, something went wrong while saving data room. Please try again.",
        };
      }
    }),

  share: withAccessControl
    .input(
      z.object({
        dataRoomId: z.string(),
        others: z.array(ShareRecipientSchema),
        selectedContacts: z.array(ShareRecipientSchema),
        expiresInDays: z
          .union([z.literal(7), z.literal(14), z.literal(30)])
          .default(30),
      }),
    )
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { session, requestIp, userAgent } = ctx;
      const { db, companyId } = ctx.tenant;
      const { dataRoomId, others, selectedContacts } = input;
      const { name: senderName, email: senderEmail } = session.user;
      const { user } = session;
      if (others.length + selectedContacts.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one recipient before sharing.",
        });
      }

      const dataRoom = await db.dataRoom.findUniqueOrThrow({
        where: {
          id: dataRoomId,
          companyId,
        },

        include: {
          company: true,
        },
      });

      if (!dataRoom) {
        throw new Error("Data room not found");
      }

      const company = dataRoom.company;

      // one instant for every recipient of this share
      const expiresAt = expiryFromDays(input.expiresInDays);

      const upsertManyRecipients = async () => {
        const recipients = [...others, ...selectedContacts];

        for (const recipient of recipients) {
          const email = (recipient.email || recipient.value).trim();
          if (!email) {
            throw new Error("Email is required");
          }

          const memberOrStakeholderId =
            recipient.type === "member"
              ? { memberId: recipient.id }
              : recipient.type === "stakeholder"
                ? { stakeholderId: recipient.id }
                : {};
          await assertTenantOwns(db, companyId, memberOrStakeholderId);

          const { recipientRecord } = await db.$transaction(async (tx) => {
            const recipientRecord = await tx.dataRoomRecipient.upsert({
              where: {
                dataRoomId_email: {
                  dataRoomId,
                  email,
                },
              },
              create: {
                dataRoomId,
                name: recipient.name,
                email,
                ...memberOrStakeholderId,
                expiresAt,
              },
              update: {
                name: recipient.name,
                ...memberOrStakeholderId,
                expiresAt,
              },
            });
            return { recipientRecord };
          });

          const token = await encode({
            companyId,
            dataRoomId,
            recipientId: recipientRecord.id,
          });

          const link = await companyUrl(
            db,
            companyId,
            `/data-rooms/${dataRoom.publicId}?token=${token}`,
          );

          await shareDataRoomEmailJob.emit({
            senderName: `${senderName}`,
            recipientName: recipient.name,
            companyName: company.name,
            dataRoom: dataRoom.name,
            link,
            email,
            senderEmail,
          });

          await db.$transaction(async (tx) => {
            await Audit.create(
              {
                action: "dataroom.shared",
                companyId: user.companyId,
                actor: { type: "user", id: user.id },
                context: {
                  userAgent,
                  requestIp,
                },
                target: [{ type: "dataroom", id: dataRoom.id }],
                summary: `${user.name} shared the data room ${dataRoom.name}`,
              },
              tx,
            );
          });
        }
      };

      await upsertManyRecipients();

      return {
        success: true,
        message: "Data room successfully shared!",
      };
    }),

  unShare: withAccessControl
    .input(
      z.object({
        dataRoomId: z.string(),
        recipientId: z.string(),
      }),
    )
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { session, requestIp, userAgent } = ctx;
      const { db, companyId } = ctx.tenant;
      const { dataRoomId, recipientId } = input;
      const { user } = session;
      const dataRoom = await db.dataRoom.findUniqueOrThrow({
        where: {
          id: dataRoomId,
          companyId,
        },
      });

      if (!dataRoom) {
        throw new Error("Data room not found");
      }

      await db.$transaction(async (tx) => {
        await tx.dataRoomRecipient.delete({
          where: {
            id: recipientId,
            dataRoomId,
          },
        });

        await Audit.create(
          {
            action: "dataroom.deleted",
            companyId: user.companyId,
            actor: { type: "user", id: user.id },
            context: {
              userAgent,
              requestIp,
            },
            target: [{ type: "dataroom", id: dataRoom.id }],
            summary: `${user.name} deleted the data room ${dataRoom.name}`,
          },
          tx,
        );
      });

      return {
        success: true,
        message: "Successfully removed access to data room!",
      };
    }),

  nudge: withAccessControl
    .input(z.object({ dataRoomId: z.string(), recipientId: z.string() }))
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { session, requestIp, userAgent } = ctx;
      const { db, companyId } = ctx.tenant;
      const { name: senderName, email: senderEmail, id: userId } = session.user;

      throwIfRefused(
        await sendReminder(db, {
          companyId,
          kind: "DATA_ROOM",
          targetId: input.dataRoomId,
          recipientId: input.recipientId,
          sender: { name: `${senderName}`, email: senderEmail },
          actor: { type: "user", id: userId },
          context: { requestIp, userAgent },
        }),
      );
      return { success: true };
    }),

  setAccess: withAccessControl
    .input(
      z.object({
        dataRoomId: z.string(),
        allowDownload: z.boolean().optional(),
        requireNda: z.boolean().optional(),
      }),
    )
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { db, companyId } = ctx.tenant;
      const { user } = ctx.session;
      const room = await db.dataRoom.findFirst({
        where: { id: input.dataRoomId, companyId },
        select: { id: true, name: true },
      });
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });

      const data = {
        ...(input.allowDownload !== undefined && {
          allowDownload: input.allowDownload,
        }),
        ...(input.requireNda !== undefined && { requireNda: input.requireNda }),
      };
      const onOff = (v: boolean) => (v ? "on" : "off");
      const changes = [
        input.allowDownload !== undefined &&
          `downloads ${onOff(input.allowDownload)}`,
        input.requireNda !== undefined &&
          `the NDA requirement ${onOff(input.requireNda)}`,
      ].filter(Boolean);

      await db.$transaction(async (tx) => {
        await tx.dataRoom.update({ where: { id: room.id }, data });
        await Audit.create(
          {
            action: "dataroom.updated",
            companyId,
            actor: { type: "user", id: user.id },
            context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
            target: [{ type: "dataroom", id: room.id }],
            summary: `${user.name} turned ${changes.join(
              " and ",
            )} for the data room ${room.name}`,
          },
          tx,
        );
      });
      return data;
    }),

  setAutoNudge: withAccessControl
    .input(z.object({ dataRoomId: z.string(), enabled: z.boolean() }))
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { db, companyId } = ctx.tenant;
      const { user } = ctx.session;
      const room = await db.dataRoom.findFirst({
        where: { id: input.dataRoomId, companyId },
        select: { id: true, name: true },
      });
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });

      await db.$transaction(async (tx) => {
        await tx.dataRoom.update({
          where: { id: room.id },
          data: { autoNudge: input.enabled },
        });
        await Audit.create(
          {
            action: "dataroom.updated",
            companyId,
            actor: { type: "user", id: user.id },
            context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
            target: [{ type: "dataroom", id: room.id }],
            summary: `${user.name} turned automatic reminders ${
              input.enabled ? "on" : "off"
            } for the data room ${room.name}`,
          },
          tx,
        );
      });
      return { enabled: input.enabled };
    }),

  stopReminders: withAccessControl
    .input(
      z.object({
        dataRoomId: z.string(),
        recipientId: z.string(),
        stopped: z.boolean(),
      }),
    )
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { db, companyId } = ctx.tenant;
      const { user } = ctx.session;
      const rec = await db.dataRoomRecipient.findFirst({
        where: {
          id: input.recipientId,
          dataRoomId: input.dataRoomId,
          dataRoom: { companyId },
        },
        select: {
          id: true,
          email: true,
          updatedAt: true,
          dataRoom: { select: { id: true, name: true } },
        },
      });
      if (!rec) throw new TRPCError({ code: "NOT_FOUND" });

      await db.$transaction(async (tx) => {
        await tx.dataRoomRecipient.update({
          where: { id: rec.id },
          // updatedAt is passed so the 3-day wait of the reminder claim is not restarted
          data: { nudgeOptOut: input.stopped, updatedAt: rec.updatedAt },
        });
        await Audit.create(
          {
            action: "dataroom.updated",
            companyId,
            actor: { type: "user", id: user.id },
            context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
            target: [{ type: "dataroom", id: rec.dataRoom.id }],
            summary: `${user.name} ${
              input.stopped ? "stopped" : "resumed"
            } automatic reminders to ${rec.email} for the data room ${
              rec.dataRoom.name
            }`,
          },
          tx,
        );
      });
      return { stopped: input.stopped };
    }),
});
