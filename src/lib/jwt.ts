import { JWT_SECRET } from "@/server/auth";
import {
  type JWTPayload,
  type JWTVerifyOptions,
  type JWTVerifyResult,
  SignJWT,
  errors,
  jwtVerify,
} from "jose";

// Lifetime of every emailed public link (e-sign, data room, investor update).
export const LINK_TTL = "30d";

export const encode = async (data: JWTPayload) => {
  return await new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(LINK_TTL)
    .sign(JWT_SECRET);
};

// PUBLIC_LINK_REQUIRE_EXPIRY and NEXTAUTH_SECRET_PREVIOUS are read per call
// (validated in src/env.js) so an operator flip or a test toggle takes effect.
export const decode = async (data: string) => {
  const options: JWTVerifyOptions = {
    algorithms: ["HS256"],
    // legacy links were issued without exp; accepted until this is turned on
    requiredClaims:
      process.env.PUBLIC_LINK_REQUIRE_EXPIRY === "1" ? ["exp"] : undefined,
  };
  try {
    return await jwtVerify(data, JWT_SECRET, options);
  } catch (error) {
    // only a wrong key is retried: expiry, claim and alg failures stand
    const previous = process.env.NEXTAUTH_SECRET_PREVIOUS;
    if (!previous || !(error instanceof errors.JWSSignatureVerificationFailed))
      throw error;
    return await jwtVerify(data, new TextEncoder().encode(previous), options);
  }
};

export type { JWTPayload, JWTVerifyResult };
