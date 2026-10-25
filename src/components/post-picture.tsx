"use client";

import { useState } from "react";

/** The post's picture. It is drawn on first view, so it may take a few seconds; if it cannot be drawn, say so plainly. */
export function PostPicture({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  if (state === "failed") {
    return <p className="text-[13px] text-[var(--muted)]">The picture could not be drawn right now. The post will go out as text only unless you press New picture and it works.</p>;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, generated picture; next/image would re-encode it for no gain */}
      <img src={src} alt={alt} width={1280} height={720} onLoad={() => setState("ok")} onError={() => setState("failed")} className={`h-auto w-full max-w-[640px] rounded-lg border border-[var(--line)] ${state === "loading" ? "animate-pulse" : ""}`} />
      {state === "loading" && <p className="mt-2 text-[12px] text-[var(--muted)]">Drawing the picture for this post. It can take a few seconds.</p>}
    </>
  );
}
