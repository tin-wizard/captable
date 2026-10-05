import { ApiError } from "@/server/api/error";
import { CompanySchema } from "@/server/api/schema/company";
import { z } from "@hono/zod-openapi";

import { authMiddleware, withAuthApiV1 } from "../../utils/endpoint-creator";

export const RequestSchema = z.object({
  id: z.string().openapi({
    param: {
      name: "id",
      in: "path",
    },
    description: "Company ID",
    type: "string",
    example: "clxwbok580000i7nge8nm1ry0",
  }),
});

const ResponseSchema = z.object({
  data: CompanySchema,
});

export const getOne = withAuthApiV1
  .createRoute({
    method: "get",
    path: "/v1/companies/{id}",
    tags: ["Company"],
    summary: "Get a company",
    description: "Fetch details of a single company by its ID.",
    middleware: [authMiddleware({ withoutMembershipCheck: true })],
    request: { params: RequestSchema },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: ResponseSchema,
          },
        },
        description: "Details of the requested company.",
      },
    },
  })
  .handler(async (c) => {
    const { db } = c.get("services");
    const { membership } = c.get("session");
    const { id: companyId } = c.req.valid("param");

    // bearer tokens carry only a userId; an undefined filter would match any member
    const { memberId, userId } = membership;
    const who = memberId ? { id: memberId } : userId ? { userId } : null;
    const member = who
      ? await db.member.findFirst({
          where: { companyId, ...who, status: "ACTIVE", isOnboarded: true },
          select: { companyId: true },
        })
      : null;

    if (!member) {
      throw new ApiError({
        code: "UNAUTHORIZED",
        message: `user is not a member of the company id:${companyId}`,
      });
    }

    const company = await db.company.findFirstOrThrow({
      where: {
        id: member.companyId,
      },
    });
    return c.json({ data: company }, 200);
  });
