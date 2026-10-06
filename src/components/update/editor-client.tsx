"use client";

import dynamic from "next/dynamic";

// Next 15 only allows `ssr: false` inside a Client Component, so the server
// page imports this wrapper instead of calling dynamic() itself.
const Editor = dynamic(() => import("./editor"), { ssr: false });

export default Editor;
