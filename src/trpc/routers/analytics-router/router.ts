import { createTRPCRouter } from "@/trpc/api/trpc";
import { documentProcedure } from "./procedures/document";
import { documentsSummaryProcedure } from "./procedures/documents-summary";
import { esignProcedure } from "./procedures/esign";
import { esignEnvelopeProcedure } from "./procedures/esign-envelope";
import { viewerVisitsProcedure } from "./procedures/viewer-visits";

export const analyticsRouter = createTRPCRouter({
  document: documentProcedure,
  documentsSummary: documentsSummaryProcedure,
  viewerVisits: viewerVisitsProcedure,
  esign: esignProcedure,
  esignEnvelope: esignEnvelopeProcedure,
});
