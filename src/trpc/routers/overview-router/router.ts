import { createTRPCRouter } from "@/trpc/api/trpc";
import { summaryProcedure } from "./procedures/summary";

export const overviewRouter = createTRPCRouter({
  summary: summaryProcedure,
});
