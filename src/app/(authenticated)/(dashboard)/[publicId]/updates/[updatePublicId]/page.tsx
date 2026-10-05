"use server";
import { getServerPermissions } from "@/lib/rbac/access-control";
import { db } from "@/server/db";
import dynamic from "next/dynamic";

const Editor = dynamic(
  () => import("../../../../../../components/update/editor"),
  { ssr: false },
);

const getUpdate = async (publicId: string) => {
  // scope to the verified membership's company, not just the public id
  const { membership } = await getServerPermissions();
  return await db.update.findFirstOrThrow({
    where: { publicId, companyId: membership.companyId },
  });
};

const UpdatePage = async ({
  params: { publicId, updatePublicId },
}: {
  params: { publicId: string; updatePublicId: string };
}) => {
  if (updatePublicId === "new") {
    return <Editor companyPublicId={publicId} mode="new" />;
  }
  const update = await getUpdate(updatePublicId);

  return <Editor companyPublicId={publicId} update={update} mode="edit" />;
};

export default UpdatePage;
