"use client";

import { useEffect, useRef, useState } from "react";

/** The post's photo. It is found on first view, so it may take a few seconds; if none is found, say so plainly. */
export function PostPicture({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const ref = useRef<HTMLImageElement>(null);
  // A cached picture can finish loading before this script runs, so check once on mount too.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete) setState(img.naturalWidth > 0 ? "ok" : "failed");
  }, []);
  if (state === "failed") {
    return <p className="text-[13px] text-[var(--muted)]">No photo found for this post right now. It will go out as text only unless you press New picture and one is found.</p>;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, generated picture; next/image would re-encode it for no gain */}
      <img ref={ref} src={src} alt={alt} width={1280} height={720} onLoad={() => setState("ok")} onError={() => setState("failed")} className={`h-auto w-full max-w-[640px] rounded-lg border border-[var(--line)] ${state === "loading" ? "animate-pulse" : ""}`} />
      {state === "loading" && <p className="mt-2 text-[12px] text-[var(--muted)]">Finding a photo for this post. It can take a few seconds.</p>}
    </>
  );
}
