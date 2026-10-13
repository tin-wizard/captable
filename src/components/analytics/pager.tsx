"use client";

import { Button } from "@/components/ui/button";
import { useUrlState } from "./use-url-state";

// Cursor pagination is forward only (keyset): "Next" appends the cursor to the
// URL, "First page" removes it.
export const Pager = ({
  nextCursor,
  hasCursor,
}: {
  nextCursor: string | null;
  hasCursor: boolean;
}) => {
  const { set } = useUrlState();
  if (!nextCursor && !hasCursor) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <Button
        size="sm"
        variant="outline"
        disabled={!hasCursor}
        onClick={() => set({ cursor: null })}
      >
        First page
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!nextCursor}
        onClick={() => set({ cursor: nextCursor })}
      >
        Next
      </Button>
    </div>
  );
};
