import { createTRPCRouter } from "@/trpc/api/trpc";
import { listActivityProcedure } from "./procedures/list";

export const activityRouter = createTRPCRouter({
  list: listActivityProcedure,
});
