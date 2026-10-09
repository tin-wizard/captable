import { constants } from "@/lib/constants";
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

export const GET = ApiReference(config);
