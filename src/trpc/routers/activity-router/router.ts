import { createTRPCRouter } from "@/trpc/api/trpc";
import { listActivityProcedure } from "./procedures/list";
import { unopenedProcedure } from "./procedures/unopened";

export const activityRouter = createTRPCRouter({
  list: listActivityProcedure,
  unopened: unopenedProcedure,
});
