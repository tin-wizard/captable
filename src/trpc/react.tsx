"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  TRPCClientError,
  loggerLink,
  unstable_httpBatchStreamLink,
} from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";

import type { AppRouter } from "@/trpc/api/root";
import { getUrl, transformer } from "./shared";

export const api = createTRPCReact<AppRouter>();

const RELOAD_FLAG = "dr-unauthorized-reload";

export function TRPCReactProvider(props: {
  children: React.ReactNode;
  /** null when company domains are off */
  canonicalHost: string | null;
}) {
  const [queryClient] = useState(() => {
    const { canonicalHost } = props;
    // Company host session expired: reload once so the server re-runs the handoff.
    const onError = (error: unknown) => {
      if (
        !canonicalHost ||
        window.location.hostname === canonicalHost ||
        !(error instanceof TRPCClientError) ||
        error.data?.code !== "UNAUTHORIZED" ||
        sessionStorage.getItem(RELOAD_FLAG)
      )
        return;
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    };
    return new QueryClient({
      queryCache: new QueryCache({
        onError,
        onSuccess: () => sessionStorage.removeItem(RELOAD_FLAG),
      }),
      mutationCache: new MutationCache({ onError }),
    });
  });

  const [trpcClient] = useState(() =>
    api.createClient({
      transformer,
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        unstable_httpBatchStreamLink({
          url: getUrl(),
          headers() {
            return {
              "x-trpc-source": "react",
            };
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}
