import { unsubscribeRecipient } from "@/server/activity/unsubscribe";
import { z } from "zod";

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE"]),
  token: z.string().min(1).max(4096),
});

// Public, token-authenticated (the recipient's own link token). Same-origin
// POST only (the proxy rejects cross-site POSTs).
export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const ok = await unsubscribeRecipient(body.data.kind, body.data.token);
  return new Response(null, { status: ok ? 204 : 404 });
};
