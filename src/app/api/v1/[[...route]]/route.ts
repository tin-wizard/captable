import api from "@/server/api";
import { getRequestHost } from "@/server/domains/request-host";

// Next 15 only allows a Request and a params context in route handlers, so
// call the Hono app directly instead of through hono/vercel's handle().
// The REST API is canonical-only: company hosts get a 404.
const handler = async (req: Request) => {
  if ((await getRequestHost()).kind !== "canonical")
    return new Response("Not found", { status: 404 });
  return api.fetch(req);
};

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as PATCH,
};
