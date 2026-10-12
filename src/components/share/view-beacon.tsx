"use client";

import { useEffect } from "react";

type Kind = "DATA_ROOM" | "UPDATE" | "ESIGN";

const INTERACTIONS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

// Records one view after the page has really rendered: the first interaction,
// or two seconds with the tab visible. A bare GET (scanner, preview) never
// reaches this, so it cannot create a view.
export const ViewBeacon = ({ kind, token }: { kind: Kind; token: string }) => {
  useEffect(() => {
    let sent = false;

    const off = () => {
      clearTimeout(timer);
      for (const e of INTERACTIONS) window.removeEventListener(e, send);
    };

    const send = () => {
      if (sent) return;
      sent = true;
      off();
      fetch("/api/activity/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, token }),
        keepalive: true,
      }).catch(() => undefined);
    };

    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") send();
    }, 2000);

    for (const e of INTERACTIONS) {
      window.addEventListener(e, send, { once: true, passive: true });
    }

    return off;
  }, [kind, token]);

  return null;
};

export const ViewNotice = () => (
  <p className="text-xs text-muted-foreground">
    Views of this page are logged (time, device and a shortened IP address) and
    shown to the sender.
  </p>
);
