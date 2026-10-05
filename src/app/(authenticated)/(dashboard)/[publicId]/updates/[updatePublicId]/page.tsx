import { getServerTenant } from "@/server/tenant";
import dynamic from "next/dynamic";

const Editor = dynamic(
  () => import("../../../../../../components/update/editor"),
  { ssr: false },
);

const getUpdate = async (publicId: string) => {
  const { db } = await getServerTenant();
  return await db.update.findFirstOrThrow({ where: { publicId } });
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
