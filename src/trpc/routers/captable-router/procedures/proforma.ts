import { modelRound } from "@/server/captable/proforma";
import { getRoundInputs } from "@/server/captable/table";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodProformaSchema } from "../schema";

type HolderRow = {
  stakeholderId: string | null;
  name: string;
  sharesBefore: number;
  pctBefore: number;
  sharesAfter: number;
  pctAfter: number;
  dilutionPts: number;
};

export const proformaProcedure = withAccessControl
  .meta({ policies: { securities: { allow: ["read"] } } })
  .input(ZodProformaSchema)
  .query(async ({ ctx, input }) => {
    const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
    const data = await getRoundInputs(
      ctx.tenant.db,
      new Date(`${asOf}T00:00:00Z`),
    );
    if (data.issued <= 0 || data.preRoundFD <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Add shares first" });
    }

    const result = modelRound({
      preRoundFD: data.preRoundFD,
      existingUnallocatedPool: data.existingUnallocatedPool,
      preMoney: input.preMoney,
      newMoney: input.newMoney,
      poolTargetPct: input.poolTargetPct,
      convertibles: data.convertibles,
    });
    // the UI hides figures when the solver did not converge
    if (!result.converged) return { ...result, holders: [], asOf };

    // pctBefore is of pre-round FD (pool included, convertibles not), pctAfter
    // of post FD; a converting holder who already holds merges into one row
    const byHolder = new Map<string, HolderRow>();
    const row = (
      id: string | null,
      name: string,
      before: number,
      after: number,
    ) => ({
      stakeholderId: id,
      name,
      sharesBefore: before,
      pctBefore: 0,
      sharesAfter: after,
      pctAfter: 0,
      dilutionPts: 0,
    });
    for (const e of data.existing) {
      byHolder.set(
        e.stakeholderId,
        row(e.stakeholderId, e.name, e.shares, e.shares),
      );
    }
    for (const c of result.conversions) {
      const h = data.holderOf.get(c.id);
      if (!h) continue;
      const r = byHolder.get(h.id) ?? row(h.id, h.name, 0, 0);
      r.sharesAfter += c.shares;
      byHolder.set(h.id, r);
    }
    const holders = [
      ...byHolder.values(),
      row(
        null,
        "Unallocated pool",
        data.existingUnallocatedPool,
        data.existingUnallocatedPool + result.poolTopUpShares,
      ),
      row(null, "New investors", 0, result.newInvestorShares),
    ].map((r) => {
      const pctBefore = r.sharesBefore / data.preRoundFD;
      const pctAfter = r.sharesAfter / result.postFD;
      return {
        ...r,
        pctBefore,
        pctAfter,
        dilutionPts: (pctAfter - pctBefore) * 100,
      };
    });

    return { ...result, holders, asOf };
  });
