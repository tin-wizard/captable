import { TRPCError } from "@trpc/server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { handleError } from "./error";

const appThrowing = (err: Error) =>
  new Hono().onError(handleError).get("/", () => {
    throw err;
  });

describe("handleError with TRPCError", () => {
  it("keeps a 4xx TRPCError message and status", async () => {
    const res = await appThrowing(
      new TRPCError({ code: "BAD_REQUEST", message: "Invalid reference" }),
    ).request("/");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Invalid reference");
  });

  it("returns the generic 500 for a 5xx TRPCError, never its message", async () => {
    const res = await appThrowing(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "secret db detail",
      }),
    ).request("/");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe(
      "Something went wrong, our engineers have been notified.",
    );
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
