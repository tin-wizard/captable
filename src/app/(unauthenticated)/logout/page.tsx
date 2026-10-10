import type { Metadata } from "next";
import { SignOut } from "./sign-out";

export const metadata: Metadata = { title: "Signing out" };

// Reached from a company host's /auth/signout. GET alone changes nothing:
// the client effect needs NextAuth's same-origin CSRF token.
export default function LogoutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-600">Signing you out…</p>
      <SignOut />
    </div>
  );
}
