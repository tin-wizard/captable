import { describe, expect, it } from "vitest";
import { createDwell, getVisiblePages, setVisiblePages } from "./dwell";

describe("createDwell", () => {
  it("counts a second of active time and a second on each visible page", () => {
    const d = createDwell();
    d.tick([1, 2]);
    d.tick([2]);
    expect(d.snapshot()).toEqual({
      activeSeconds: 2,
      pageSeconds: { "1": 1, "2": 2 },
    });
  });

  it("starts empty and snapshots are copies", () => {
    const d = createDwell();
    const s = d.snapshot();
    d.tick([1]);
    expect(s).toEqual({ activeSeconds: 0, pageSeconds: {} });
  });

  it("caps a page at 3600 seconds, the heartbeat's limit, but not active time", () => {
    const d = createDwell();
    for (let i = 0; i < 3601; i++) d.tick([1]);
    expect(d.snapshot()).toEqual({
      activeSeconds: 3601,
      pageSeconds: { "1": 3600 },
    });
  });
});

describe("visible pages store", () => {
  it("publishes the set of pages currently on screen", () => {
    setVisiblePages([3, 4]);
    expect(getVisiblePages().sort()).toEqual([3, 4]);
    setVisiblePages([]);
    expect(getVisiblePages()).toEqual([]);
  });
});
