import { PublicEnvScript } from "@/components/public-env-script";
import ScreenSize from "@/components/screen-size";
import { constants } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { NextAuthProvider } from "@/providers/next-auth";
import { ProgressBarProvider } from "@/providers/progress-bar";
import { getServerComponentAuthSession } from "@/server/auth";
import { inter, interTight, robotoMono } from "@/styles/fonts";
import "@/styles/globals.css";
import { TRPCReactProvider } from "@/trpc/react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: {
    template: `%s | ${constants.title}`,
    default: constants.title,
  },
  description: constants.description,
  metadataBase: new URL(constants.url),
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerComponentAuthSession();
  const nodeEnv = process.env.NODE_ENV;

  return (
    <html
      lang="en"
      className={cn(inter.variable, interTight.variable, robotoMono.variable)}
    >
      <head>
        <PublicEnvScript />
      </head>
      <body className="min-h-screen">
        <ProgressBarProvider>
          <NextAuthProvider session={session}>
            <TRPCReactProvider cookies={(await cookies()).toString()}>
              <main>{children}</main>
              <Toaster richColors />
              {nodeEnv === "development" && <ScreenSize />}
            </TRPCReactProvider>
          </NextAuthProvider>
        </ProgressBarProvider>
      </body>
    </html>
  );
}
