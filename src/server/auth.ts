/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import {
  type DefaultSession,
  type NextAuthOptions,
  type Session,
  getServerSession,
} from "next-auth";

import { env } from "@/env";
import { getAuthenticatorOptions } from "@/lib/authenticator";
import {
  type TAuthenticationResponseJSONSchema,
  ZAuthenticationResponseJSONSchema,
} from "@/lib/types";
import type { MemberStatusEnum } from "@/prisma/enums";
import { type TPrismaOrTransaction, db } from "@/server/db";
import { getRequestHost } from "@/server/domains/request-host";
import {
  TENANT_SESSION_SECONDS,
  type TenantClaims,
  readTenantSession,
  tenantCookieName,
} from "@/server/domains/tenant-session";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { cookies } from "next/headers";
import { cache } from "react";
import { getUserByEmail, getUserById } from "./user";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const JWT_SECRET = new TextEncoder().encode(env.NEXTAUTH_SECRET);

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    sv?: number;
    user: {
      id: string;
      isOnboarded: boolean;
      companyId: string;
      memberId: string;
      companyPublicId: string;
      status: MemberStatusEnum | "";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    companyId: string;
    memberId: string;
    isOnboarded: boolean;
    companyPublicId: string;
    status: MemberStatusEnum | "";
    sv?: number;
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  events: {
    async linkAccount({ user }) {
      await db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    },
    async signOut({ token }) {
      if (token?.sub) await bumpSessionVersion(token.sub);
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "credentials") return true;

      const existingUser = await getUserById(user.id);
      if (!existingUser?.emailVerified) return false;

      return true;
    },
    session({ session, token }) {
      session.user.isOnboarded = token.isOnboarded;
      session.user.companyId = token.companyId;
      session.user.memberId = token.memberId;
      session.user.companyPublicId = token.companyPublicId;
      session.user.status = token.status;
      session.user.name = token.name;
      session.user.email = token.email;
      session.user.image = token.picture ?? "";

      if (token.sub) {
        session.user.id = token.sub;
      }
      session.sv = token.sv;
      return session;
    },

    async jwt({ token, trigger }) {
      // Only at sign-in: an "update" must not refresh a revoked token's sv.
      if (trigger === "signIn" || trigger === "signUp") {
        const u = await db.user.findUnique({
          where: { id: token.sub },
          select: { sessionVersion: true },
        });
        token.sv = u?.sessionVersion ?? 0;
      }
      if (trigger) {
        const member = await db.member.findFirst({
          where: {
            userId: token.sub,
            isOnboarded: true,
            status: "ACTIVE",
          },
          orderBy: {
            lastAccessed: "desc",
          },
          select: {
            id: true,
            status: true,
            companyId: true,
            isOnboarded: true,
            user: {
              select: {
                name: true,
                image: true,
              },
            },
            company: {
              select: {
                publicId: true,
              },
            },
          },
        });
        if (member) {
          token.status = member.status;
          token.name = member.user?.name;
          token.memberId = member.id;
          token.companyId = member.companyId;
          token.isOnboarded = member.isOnboarded;
          token.companyPublicId = member.company.publicId;
          token.picture = member.user?.image;
        } else {
          token.status = "";
          token.companyId = "";
          token.memberId = "";
          token.isOnboarded = false;
          token.companyPublicId = "";
        }
      }
      return token;
    },
  },
  // @ts-expect-error
  adapter: PrismaAdapter(db),
  secret: env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (credentials) {
          const { email, password } = credentials;
          const user = await getUserByEmail(email);
          if (!user || !user.password) return null;
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
        }
        return null;
      },
    }),

    CredentialsProvider({
      id: "webauthn",
      name: "Keypass",
      credentials: {
        csrfToken: { label: "csrfToken", type: "csrfToken" },
      },
      async authorize(credentials, req) {
        const csrfToken = credentials?.csrfToken;

        if (typeof csrfToken !== "string" || csrfToken.length === 0) {
          throw new Error("Invalid csrfToken");
        }

        let requestBodyCrediential: TAuthenticationResponseJSONSchema | null =
          null;

        try {
          //eslint-disable-next-line  @typescript-eslint/no-unsafe-argument
          const parsedBodyCredential = JSON.parse(req.body?.credential);
          requestBodyCrediential =
            ZAuthenticationResponseJSONSchema.parse(parsedBodyCredential);
        } catch {
          throw new Error("Invalid request");
        }

        const challengeToken = await db.passkeyVerificationToken
          .delete({
            where: {
              id: csrfToken,
            },
          })
          .catch(() => null);

        if (!challengeToken) {
          return null;
        }

        if (challengeToken.expiresAt < new Date()) {
          throw new Error("Challenge token has expired.");
        }

        const passkey = await db.passkey.findFirst({
          where: {
            credentialId: Buffer.from(requestBodyCrediential.id),
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                emailVerified: true,
              },
            },
          },
        });

        if (!passkey) {
          throw new Error("Cannot setup passkey.");
        }

        const user = passkey.user;

        const { rpId, origin } = getAuthenticatorOptions();

        const verification = await verifyAuthenticationResponse({
          response: requestBodyCrediential,
          expectedChallenge: challengeToken.token,
          expectedOrigin: origin,
          expectedRPID: rpId,
          authenticator: {
            //@ts-expect-error error
            credentialID: new Uint8Array(Array.from(passkey.credentialId)),
            credentialPublicKey: new Uint8Array(passkey.credentialPublicKey),
            counter: Number(passkey.counter),
          },
        }).catch(() => null);

        if (!verification?.verified) {
          throw new Error("Passkey verification failed.");
        }

        //@TODO (Add audits for verification.verified event)

        await db.passkey.update({
          where: {
            id: passkey.id,
          },
          data: {
            lastUsedAt: new Date(),
            counter: verification.authenticationInfo.newCounter,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified?.toISOString() ?? null,
        };
      },
    }),
    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Discord provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
    GoogleProvider({
      clientId: GOOGLE_CLIENT_ID as string,
      clientSecret: GOOGLE_CLIENT_SECRET as string,
    }),
  ],

  pages: {
    signIn: "/login",
    signOut: "/login",
  },
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */

export async function bumpSessionVersion(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}

// undefined = pre-sessionVersion token (counts as 0); any other non-number is stale.
export async function isSessionVersionCurrent(
  userId: string,
  sv: number | undefined,
) {
  const v = sv === undefined ? 0 : sv;
  if (typeof v !== "number") return false;
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return !!u && u.sessionVersion === v;
}

export function sessionFromTenantClaims(
  c: TenantClaims,
  expires: Date,
): Session {
  return {
    expires: expires.toISOString(),
    sv: c.sv,
    user: {
      id: c.sub,
      companyId: c.cid,
      memberId: c.mid,
      companyPublicId: c.pid,
      isOnboarded: true,
      status: "ACTIVE",
      name: c.name ?? null,
      email: c.email ?? null,
      image: c.picture ?? null,
    },
  };
}

export const getServerAuthSession = async (): Promise<Session | null> => {
  const host = await getRequestHost();
  if (host.kind === "canonical") {
    const s = await getServerSession(authOptions);
    if (!s?.user?.id) return s;
    return (await isSessionVersionCurrent(s.user.id, s.sv)) ? s : null;
  }
  if (host.kind !== "tenant") return null;
  const raw = (await cookies()).get(tenantCookieName())?.value;
  const c = await readTenantSession(raw, host.hostname);
  if (
    !c ||
    c.cid !== host.companyId ||
    !(await isSessionVersionCurrent(c.sub, c.sv))
  )
    return null;
  return sessionFromTenantClaims(
    c,
    new Date(Date.now() + TENANT_SESSION_SECONDS * 1000),
  );
};

export const getServerComponentAuthSession = cache(() =>
  getServerAuthSession(),
);

export const withServerSession = async () => {
  const session = await getServerAuthSession();

  if (!session) {
    throw new Error("session not found");
  }

  return session;
};

export const withServerComponentSession = cache(async () => {
  const session = await getServerComponentAuthSession();

  if (!session) {
    throw new Error("session not found");
  }

  return session;
});

export interface checkMembershipOptions {
  session: Session;
  tx: TPrismaOrTransaction;
}

export async function checkMembership({ session, tx }: checkMembershipOptions) {
  const {
    memberId: claimedMember,
    companyId: claimedCompany,
    id: claimedUser,
  } = session.user ?? {};
  // Prisma treats `undefined` as "no filter": an empty or partial session
  // (e.g. next-auth's `{}` for an undecodable cookie) would otherwise match
  // the first active member of any company.
  if (!claimedMember || !claimedCompany || !claimedUser) {
    throw new Error("membership not found");
  }

  const data = await tx.member.findFirst({
    where: {
      id: session.user.memberId,
      companyId: session.user.companyId,
      userId: session.user.id,
      isOnboarded: true,
      status: "ACTIVE",
    },
    select: {
      id: true,
      companyId: true,
      role: true,
      customRoleId: true,
      userId: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  if (!data) {
    throw new Error("membership not found");
  }

  const { companyId, id: memberId, ...rest } = data;

  return { companyId, memberId, ...rest };
}
