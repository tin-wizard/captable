import { getCapTable } from "@/server/captable/table";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodCapTableSchema } from "../schema";

export const capTableProcedure = withAccessControl
  .meta({ policies: { securities: { allow: ["read"] } } })
  .input(ZodCapTableSchema)
  .query(({ ctx, input }) => getCapTable(ctx.tenant.db, input));
