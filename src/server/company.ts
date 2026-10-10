import { db } from "./db";
import { companyHomeUrl } from "./domains/links";

export const getCompanyList = async (userId: string) => {
  const data = await db.member.findMany({
    where: {
      userId,
      status: "ACTIVE",
      isOnboarded: true,
    },
    select: {
      id: true,
      company: {
        select: {
          id: true,
          publicId: true,
          name: true,
        },
      },
    },
  });

  return Promise.all(
    data.map(async (m) => ({
      ...m,
      url: await companyHomeUrl(db, m.company.id, m.company.publicId),
    })),
  );
};

export type TGetCompanyList = Awaited<ReturnType<typeof getCompanyList>>;
