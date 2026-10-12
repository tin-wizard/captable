"use client";

import { dayjsExt } from "@/common/dayjs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/trpc/react";
import { countryName, formatDuration, topPages } from "./format";

type Props = {
  kind?: "DATA_ROOM" | "UPDATE" | "ESIGN";
  targetPublicId?: string;
};

export const ActivityTable = ({ kind, targetPublicId }: Props) => {
  const {
    data,
    error,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = api.activity.list.useInfiniteQuery(
    { kind, targetPublicId, limit: 25 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  // callers without audits:read see nothing
  if (error?.data?.code === "UNAUTHORIZED") return null;
  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        Activity could not be loaded.
      </p>
    );
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">When</TableHead>
            <TableHead scope="col">Viewer</TableHead>
            <TableHead scope="col">Where</TableHead>
            <TableHead scope="col">Time spent</TableHead>
            <TableHead scope="col">Pages</TableHead>
            <TableHead scope="col" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                No views yet.
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => {
              const pages = topPages(item.pageSeconds, 3);
              const country = countryName(item.country);
              return (
                <TableRow key={item.id}>
                  <TableCell title={new Date(item.createdAt).toISOString()}>
                    {dayjsExt(item.createdAt).fromNow()}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{item.viewer.label}</div>
                    {item.viewer.stakeholder && (
                      <div className="text-xs text-muted-foreground">
                        {item.viewer.stakeholder.name}
                        {item.viewer.stakeholder.shares !== null &&
                          ` · ${item.viewer.stakeholder.shares.toLocaleString()} shares`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{country ?? "—"}</div>
                    {(item.network || item.timezone) && (
                      <div className="text-xs text-muted-foreground">
                        {[item.network, item.timezone]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{formatDuration(item.activeSeconds)}</TableCell>
                  <TableCell>
                    {pages.length
                      ? pages
                          .map(
                            (p) => `p.${p.page} · ${formatDuration(p.seconds)}`,
                          )
                          .join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {item.isBot && (
                      <Badge variant="warning">Atypical source</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          Load more
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Location by{" "}
        <a
          href="https://ipinfo.io"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          IPinfo.io
        </a>
      </p>
    </div>
  );
};
