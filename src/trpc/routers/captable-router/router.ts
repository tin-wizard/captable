import { createTRPCRouter } from "@/trpc/api/trpc";
import { proformaProcedure } from "./procedures/proforma";
import { capTableProcedure } from "./procedures/table";

export const captableRouter = createTRPCRouter({
  table: capTableProcedure,
  proforma: proformaProcedure,
});
