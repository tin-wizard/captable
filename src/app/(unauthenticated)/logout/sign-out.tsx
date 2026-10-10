"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";

export function SignOut() {
  useEffect(() => {
    void signOut({ callbackUrl: "/login" });
  }, []);
  return null;
}
