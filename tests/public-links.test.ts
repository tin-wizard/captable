import { LINK_TTL, decode, encode } from "@/lib/jwt";
import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import { EncodeEmailToken } from "@/trpc/routers/template-field-router/procedures/add-fields";
import { TRPCError } from "@trpc/server";
import { type JWTPayload, SignJWT, decodeJwt, errors } from "jose";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Public links (e-sign, data room, investor update) carry a signed JWT. They
 * must expire, survive a secret rotation, and never accept a foreign alg.
 */

const key = (secret: string) => new TextEncoder().encode(secret);
const CURRENT = key(process.env.NEXTAUTH_SECRET as string);
const PREVIOUS_SECRET = `previous-${nanoid(32)}`;
const OTHER = key(`unrelated-${nanoid(32)}`);
const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

function sign(
  payload: JWTPayload,
  secret: Uint8Array,
  { exp, alg = "HS256" }: { exp?: number; alg?: string } = {},
) {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg }).setIssuedAt();
  if (exp !== undefined) jwt.setExpirationTime(exp);
  return jwt.sign(secret);
}

const payload = { id: "template-id", rec: "recipient-id" };
const expired = (secret: Uint8Array, p: JWTPayload = payload) =>
  sign(p, secret, { exp: now() - 60 });

afterEach(() => {
  // assigning undefined would store the string "undefined" in process.env
  Reflect.deleteProperty(process.env, "PUBLIC_LINK_REQUIRE_EXPIRY");
  Reflect.deleteProperty(process.env, "NEXTAUTH_SECRET_PREVIOUS");
});

describe("encode", () => {
  it(`issues iat and exp = ${LINK_TTL} from now`, async () => {
    const { iat, exp } = decodeJwt(await encode(payload));
    expect(iat).toBeGreaterThan(now() - 60);
    expect(iat).toBeLessThanOrEqual(now());
    expect((exp as number) - (iat as number)).toBeGreaterThan(30 * DAY - 60);
    expect((exp as number) - (iat as number)).toBeLessThan(30 * DAY + 60);
  });

  it("round-trips through decode", async () => {
    const { payload: out } = await decode(await encode(payload));
    expect(out).toMatchObject(payload);
  });
});

describe("decode", () => {
  it("rejects an expired token signed with the current secret", async () => {
    await expect(decode(await expired(CURRENT))).rejects.toBeInstanceOf(
      errors.JWTExpired,
    );
  });

  it("accepts a legacy token without exp unless PUBLIC_LINK_REQUIRE_EXPIRY=1", async () => {
    const legacy = await sign(payload, CURRENT);
    await expect(decode(legacy)).resolves.toBeTruthy();

    process.env.PUBLIC_LINK_REQUIRE_EXPIRY = "0";
    await expect(decode(legacy)).resolves.toBeTruthy();

    process.env.PUBLIC_LINK_REQUIRE_EXPIRY = "1";
    await expect(decode(legacy)).rejects.toBeInstanceOf(
      errors.JWTClaimValidationFailed,
    );
    // a token that has exp still passes with the switch on
    await expect(decode(await encode(payload))).resolves.toBeTruthy();
  });

  it("accepts a token signed with the previous secret only when NEXTAUTH_SECRET_PREVIOUS is set", async () => {
    const token = await sign(payload, key(PREVIOUS_SECRET), {
      exp: now() + DAY,
    });
    await expect(decode(token)).rejects.toBeInstanceOf(
      errors.JWSSignatureVerificationFailed,
    );

    process.env.NEXTAUTH_SECRET_PREVIOUS = PREVIOUS_SECRET;
    const { payload: out } = await decode(token);
    expect(out).toMatchObject(payload);
  });

  it("applies the expiry switch to previous-secret tokens too", async () => {
    process.env.NEXTAUTH_SECRET_PREVIOUS = PREVIOUS_SECRET;
    process.env.PUBLIC_LINK_REQUIRE_EXPIRY = "1";
    await expect(
      decode(await sign(payload, key(PREVIOUS_SECRET))),
    ).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed);
  });

  it("rejects an expired previous-secret token (the retry does not bypass exp)", async () => {
    process.env.NEXTAUTH_SECRET_PREVIOUS = PREVIOUS_SECRET;
    await expect(
      decode(await expired(key(PREVIOUS_SECRET))),
    ).rejects.toBeInstanceOf(errors.JWTExpired);
  });

  it("always rejects a token signed with an unrelated secret", async () => {
    const token = await sign(payload, OTHER, { exp: now() + DAY });
    await expect(decode(token)).rejects.toBeInstanceOf(
      errors.JWSSignatureVerificationFailed,
    );
    process.env.NEXTAUTH_SECRET_PREVIOUS = PREVIOUS_SECRET;
    await expect(decode(token)).rejects.toBeInstanceOf(
      errors.JWSSignatureVerificationFailed,
    );
  });

  it("rejects alg none and any alg other than HS256, even with the right secret", async () => {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsecured = `${b64({ alg: "none" })}.${b64({
      ...payload,
      exp: now() + DAY,
    })}.`;
    await expect(decode(unsecured)).rejects.toThrow();

    for (const alg of ["HS384", "HS512"]) {
      const token = await sign(payload, CURRENT, { alg, exp: now() + DAY });
      await expect(decode(token)).rejects.toBeInstanceOf(
        errors.JOSEAlgNotAllowed,
      );
    }
    // and the previous-secret retry does not open the alg door either: the
    // algorithm is refused before any key is tried
    process.env.NEXTAUTH_SECRET_PREVIOUS = PREVIOUS_SECRET;
    const token = await sign(payload, key(PREVIOUS_SECRET), {
      alg: "HS512",
      exp: now() + DAY,
    });
    await expect(decode(token)).rejects.toBeInstanceOf(
      errors.JOSEAlgNotAllowed,
    );
  });

  it("rejects expired data-room and investor-update tokens", async () => {
    const dataRoom = { companyId: "c", dataRoomId: "d", recipientId: "r" };
    const update = { publicId: "p", companyId: "c", recipientId: "r" };
    for (const p of [dataRoom, update]) {
      await expect(decode(await expired(CURRENT, p))).rejects.toBeInstanceOf(
        errors.JWTExpired,
      );
      const { payload: out, protectedHeader } = await decode(await encode(p));
      expect(out).toMatchObject(p);
      expect(out.exp).toBeGreaterThan(now() + 29 * DAY);
      expect(protectedHeader.alg).toBe("HS256");
    }
  });
});

describe("e-sign procedures", () => {
  const anon = appRouter.createCaller({
    db,
    session: null,
    requestIp: "127.0.0.1",
    userAgent: "vitest",
    headers: new Headers(),
    host: { kind: "canonical" },
  });
  const signInput = (token: string) => ({ token, data: {} });

  const code = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      (e: unknown) => (e instanceof TRPCError ? e.code : String(e)),
    );

  it("template.getSigningFields and template.sign reject an expired token as UNAUTHORIZED", async () => {
    const token = await expired(CURRENT, { id: nanoid(), rec: nanoid() });
    expect(await code(anon.template.getSigningFields({ token }))).toBe(
      "UNAUTHORIZED",
    );
    expect(await code(anon.template.sign(signInput(token)))).toBe(
      "UNAUTHORIZED",
    );
  });

  it("an invalid signature fails the same way", async () => {
    const token = await sign({ id: nanoid(), rec: nanoid() }, OTHER, {
      exp: now() + DAY,
    });
    expect(await code(anon.template.getSigningFields({ token }))).toBe(
      "UNAUTHORIZED",
    );
  });

  it("a fresh token gets past decode (fails later, on the unknown recipient)", async () => {
    const token = await EncodeEmailToken({
      templateId: nanoid(),
      recipientId: nanoid(),
    });
    const result = await code(anon.template.getSigningFields({ token }));
    expect(result).not.toBe("UNAUTHORIZED");
    expect(result).not.toBe("resolved");
  });
});
