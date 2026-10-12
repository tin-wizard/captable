"use client";

import { useEffect } from "react";
import { createDwell, getVisiblePages } from "./dwell";

type Kind = "DATA_ROOM" | "UPDATE" | "ESIGN";

const INTERACTIONS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

// Any of these keeps the viewer "active" for ACTIVE_WINDOW_MS.
const ACTIVITY = [
  "pointerdown",
  "pointermove",
  "keydown",
  "scroll",
  "touchstart",
] as const;
const ACTIVE_WINDOW_MS = 30_000;
const FLUSH_EVERY_S = 15;

// Records one view after the page has really rendered: the first interaction,
// or two seconds with the tab visible. A bare GET (scanner, preview) never
// reaches this, so it cannot create a view. Once the view is recorded, active
// time and per-page seconds are reported by heartbeat.
export const ViewBeacon = ({ kind, token }: { kind: Kind; token: string }) => {
  useEffect(() => {
    let sent = false;
    let cancelled = false;
    let stopTracking: (() => void) | undefined;

    const off = () => {
      clearTimeout(timer);
      for (const e of INTERACTIONS) window.removeEventListener(e, send);
    };

    const track = (visitId: string) => {
      const dwell = createDwell();
      let lastActivity = Date.now();
      let lastFlushed = 0;
      const touch = () => {
        lastActivity = Date.now();
      };

      const flush = () => {
        const { activeSeconds, pageSeconds } = dwell.snapshot();
        if (activeSeconds === 0 || activeSeconds === lastFlushed) return;
        lastFlushed = activeSeconds;
        fetch("/api/activity/visit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            token,
            visitId,
            activeSeconds,
            pageSeconds,
          }),
          keepalive: true,
        }).catch(() => undefined);
      };

      const onHide = () => {
        if (document.visibilityState === "hidden") flush();
      };

      for (const e of ACTIVITY) {
        window.addEventListener(e, touch, { passive: true });
      }
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", flush);

      let secs = 0;
      const interval = setInterval(() => {
        if (
          document.visibilityState === "visible" &&
          Date.now() - lastActivity < ACTIVE_WINDOW_MS
        ) {
          dwell.tick(getVisiblePages());
        }
        if (++secs % FLUSH_EVERY_S === 0) flush();
      }, 1000);

      return () => {
        clearInterval(interval);
        for (const e of ACTIVITY) window.removeEventListener(e, touch);
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", flush);
        flush();
      };
    };

    const send = () => {
      if (sent) return;
      sent = true;
      off();
      let timezone: string | undefined;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        // leave undefined; the server treats it as unknown
      }
      fetch("/api/activity/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, token, timezone }),
        keepalive: true,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { visitId?: unknown } | null) => {
          if (cancelled || typeof body?.visitId !== "string") return;
          stopTracking = track(body.visitId);
        })
        .catch(() => undefined);
    };

    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") send();
    }, 2000);

    for (const e of INTERACTIONS) {
      window.addEventListener(e, send, { once: true, passive: true });
    }

    return () => {
      cancelled = true;
      off();
      stopTracking?.();
    };
  }, [kind, token]);

  return null;
};

export const ViewNotice = () => (
  <p className="text-xs text-muted-foreground">
    Views of this page are logged (time, device, approximate location and a
    shortened IP address) and shown to the sender. Location data by{" "}
    <a
      href="https://ipinfo.io"
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      IPinfo.io
    </a>
    .
  </p>
);
