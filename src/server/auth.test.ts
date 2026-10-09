import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAuthenticationResponse = vi.fn();
const passkeyUpdate = vi.fn();

vi.mock("@simplewebauthn/server", () => ({ verifyAuthenticationResponse }));
vi.mock("@/lib/authenticator", () => ({
  getAuthenticatorOptions: () => ({
    rpId: "dealroom.test",
    origin: "https://dealroom.test",
  }),
}));
vi.mock("@/server/db", () => ({
  db: {
    passkeyVerificationToken: {
      delete: () =>
        Promise.resolve({
          token: "challenge",
          expiresAt: new Date(Date.now() + 60_000),
        }),
    },
    passkey: {
      findFirst: () =>
        Promise.resolve({
          id: "pk1",
          credentialId: Buffer.from("cred"),
          credentialPublicKey: Buffer.from("key"),
          counter: 1n,
          user: { id: "u1", email: "a@b.c", name: "A", emailVerified: null },
        }),
      update: passkeyUpdate,
    },
  },
}));

const { authOptions } = await import("./auth");

// next-auth keeps the user-supplied id and authorize on `options`
const webauthn = authOptions.providers.find(
  (p) => (p as { options?: { id?: string } }).options?.id === "webauthn",
) as unknown as {
  options: {
    authorize: (
      c: Record<string, string>,
      req: { body: Record<string, string> },
    ) => Promise<unknown>;
  };
};

const credential = JSON.stringify({
  id: "cred",
  rawId: "cred",
  type: "public-key",
  response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" },
  clientExtensionResults: {},
});

const login = () =>
  webauthn.options.authorize({ csrfToken: "t1" }, { body: { credential } });

describe("passkey login", () => {
  beforeEach(() => {
    verifyAuthenticationResponse.mockReset();
    passkeyUpdate.mockReset();
  });

  it("logs in when the assertion verifies", async () => {
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    });
    await expect(login()).resolves.toMatchObject({ id: "u1" });
    expect(passkeyUpdate).toHaveBeenCalledOnce();
  });

  it("refuses a forged assertion that fails verification", async () => {
    verifyAuthenticationResponse.mockResolvedValue({ verified: false });
    await expect(login()).rejects.toThrow("Passkey verification failed.");
    expect(passkeyUpdate).not.toHaveBeenCalled();
  });

  it("refuses when verification throws", async () => {
    verifyAuthenticationResponse.mockRejectedValue(new Error("bad signature"));
    await expect(login()).rejects.toThrow("Passkey verification failed.");
    expect(passkeyUpdate).not.toHaveBeenCalled();
  });
});
