import type { Table, Updater } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";

// TanStack's built-in page auto-reset queues a state update during the first
// render, which React 19 reports as an update on an unmounted component. Set
// `autoResetPageIndex: false` and wrap sort/filter setters with this instead:
// the reset then only runs from user actions.
// Callers annotate the getter's return type (`(): PageResettable => table`):
// an unannotated `() => table` makes the table's type circular.
export type PageResettable = Pick<Table<unknown>, "setPageIndex">;

export function resetPageOn<TState>(
  set: Dispatch<SetStateAction<TState>>,
  getTable: () => PageResettable,
) {
  return (updater: Updater<TState>) => {
    set(updater);
    getTable().setPageIndex(0);
  };
}
