import { constants } from "@/lib/constants";
import { getRequestHost } from "@/server/domains/request-host";
import { ApiReference } from "@scalar/nextjs-api-reference";

const config = {
  spec: {
    url: "/api/v1/schema",
  },
  metaData: {
    title: `${constants.title} API Docs`,
    description: `${constants.title} API Docs`,
  },
};

const docs = ApiReference(config);

// Canonical-only, like the REST API it documents.
export const GET = async () =>
  (await getRequestHost()).kind === "canonical"
    ? docs()
    : new Response("Not found", { status: 404 });
