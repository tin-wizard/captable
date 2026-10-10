import type { TPrisma } from "./db";

/**
 * tenantDb(db, companyId): a Prisma client whose queries on tenant models are
 * filtered to, and stamped with, one company.
 *
 * Scoped:
 *   - TENANT_MODELS (direct companyId): `where` of every read/update/delete/
 *     count/aggregate/groupBy/upsert gets `companyId` forced; create,
 *     createMany, createManyAndReturn and upsert.create are stamped; a
 *     `companyId` key in update data is forced back to this company.
 *   - PARENT_SCOPED children: `where` (and upsert.where) also requires
 *     `<parent>.companyId`.
 *   - Raw SQL ($queryRaw, $executeRaw, *Unsafe) throws: use ctx.db and filter
 *     by companyId yourself.
 *
 * NOT scoped (known limits; tests/tenant/tenant-db.test.ts pins them):
 *   - nested writes inside `data` (relation connect/create/update)
 *   - `include`/`select` of a relation: returns whatever row the FK points at
 *   - create/createMany on a child model: the parent id is not checked
 *   - FK ids supplied as data (stakeholderId, bucketId, ...): Task 5b
 *   - Company and global models (User, tokens, billing)
 *   - BillingCustomer: companyId is nullable and billing rows are written by
 *     Stripe webhooks without a tenant, so it stays global on purpose
 */

// models with a direct companyId column
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  "BankAccount",
  "Member",
  "CustomRole",
  "Stakeholder",
  "Audit",
  "ShareClass",
  "EquityPlan",
  "Document",
  "DataRoom",
  "Template",
  "Share",
  "Option",
  "Investment",
  "Safe",
  "ConvertibleNote",
  "Update",
  "EsignAudit",
  "CompanyDomain",
  // companyId is nullable only for legacy orphans, which no tenant can see
  "Bucket",
]);

// child models scoped only through a parent relation
export const PARENT_SCOPED: Readonly<Record<string, string>> = {
  TemplateField: "template",
  EsignRecipient: "template",
  DataRoomDocument: "dataRoom",
  DataRoomRecipient: "dataRoom",
  DocumentShare: "document",
  UpdateRecipient: "update",
};

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

const noRaw = () => {
  throw new Error("tenantDb: raw SQL is not tenant-scoped, use ctx.db");
};

export function tenantDb(db: TPrisma, companyId: string) {
  // biome-ignore lint/suspicious/noExplicitAny: args shape varies per operation
  const forceCompany = (data: any) =>
    data && "companyId" in data ? { ...data, companyId } : data;

  return db.$extends({
    name: "tenant-scope",
    query: {
      $queryRaw: noRaw,
      $executeRaw: noRaw,
      $queryRawUnsafe: noRaw,
      $executeRawUnsafe: noRaw,
      $allModels: {
        // biome-ignore lint/suspicious/noExplicitAny: args shape varies per operation
        async $allOperations({ model, operation, args, query }: any) {
          const a = { ...args };
          if (TENANT_MODELS.has(model)) {
            if (WHERE_OPS.has(operation)) a.where = { ...a.where, companyId };
            if (operation === "create") a.data = { ...a.data, companyId };
            else if (operation.startsWith("createMany"))
              a.data = [a.data]
                .flat()
                .map((d: object) => ({ ...d, companyId }));
            else if (operation === "upsert") {
              a.create = { ...a.create, companyId };
              a.update = forceCompany(a.update);
            } else if (operation.startsWith("update"))
              a.data = forceCompany(a.data);
            else if (!WHERE_OPS.has(operation))
              throw new Error(`tenantDb: unsupported ${model}.${operation}`);
          } else if (model in PARENT_SCOPED && WHERE_OPS.has(operation)) {
            // AND keeps the caller's own filter on the same relation
            const scope = { [PARENT_SCOPED[model] as string]: { companyId } };
            a.where = {
              ...a.where,
              AND: [scope, ...[a.where?.AND ?? []].flat()],
            };
          }
          return query(a);
        },
      },
    },
  });
}
