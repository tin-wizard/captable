import { createTRPCRouter } from "@/trpc/api/trpc";
import { documentProcedure } from "./procedures/document";
import { documentsSummaryProcedure } from "./procedures/documents-summary";
import { viewerVisitsProcedure } from "./procedures/viewer-visits";

export const analyticsRouter = createTRPCRouter({
  document: documentProcedure,
  documentsSummary: documentsSummaryProcedure,
  viewerVisits: viewerVisitsProcedure,
});
