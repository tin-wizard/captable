import api from "@/server/api";

// Next 15 only allows a Request and a params context in route handlers, so
// call the Hono app directly instead of through hono/vercel's handle().
const handler = (req: Request) => api.fetch(req);

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as PATCH,
};
