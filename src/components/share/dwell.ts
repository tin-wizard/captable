export type Dwell = {
  activeSeconds: number;
  pageSeconds: Record<string, number>;
};

export function createDwell() {
  let active = 0;
  const pages: Record<string, number> = {};
  return {
    // called once per second while the tab is visible and the viewer was recently active
    tick(visiblePages: number[]) {
      active += 1;
      // the heartbeat route rejects a page above 3600 with a 400
      for (const p of visiblePages)
        pages[String(p)] = Math.min(3600, (pages[String(p)] ?? 0) + 1);
    },
    snapshot: (): Dwell => ({
      activeSeconds: active,
      pageSeconds: { ...pages },
    }),
  };
}

// PdfViewer publishes which pages are on screen; the beacon reads it each second.
let visible = new Set<number>();
export const setVisiblePages = (pages: Iterable<number>) => {
  visible = new Set(pages);
};
export const getVisiblePages = () => [...visible];
