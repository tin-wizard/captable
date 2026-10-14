import { getFileFromS3 } from "@/server/file-uploads";

// Company logos and avatars live in the private bucket; this is the only way
// they are readable without a session (share pages, emails). The key shape
// is checked so no other object can be reached through it.
const KEY =
  /^[\w-]+\/(?:company-logos|profile-avatars)-[\w-]+\.(png|jpe?g|webp|gif)$/i;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const key = (await params).key.map(decodeURIComponent).join("/");
  const match = KEY.exec(key);
  if (!match?.[1]) return new Response("Not found", { status: 404 });

  try {
    const body = await getFileFromS3(key);
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[match[1].toLowerCase()] ?? "image/png",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        // keys are random and never reused
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
