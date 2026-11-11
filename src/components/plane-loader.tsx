"use client";

// PostFlow's loader: the paper plane from the logo flies along a gentle curve and draws its marigold trail.
// People who ask for less motion see the plane at rest at the end of its trail instead.

import { useId } from "react";

const PATH = "M6 40 C 26 40, 34 14, 58 19 S 92 37, 114 12";

function Plane({ color }: { color: string }) {
  return (
    <g transform="scale(1.35)">
      <path d="M9 0 -8 -6.2 -2.6 0.6z" fill={color} />
      <path d="M9 0 -2.6 0.6 0.4 7.2z" fill={color} opacity="0.72" />
    </g>
  );
}

export function PlaneLoader({ size = "md", label = "Working on it" }: { size?: "sm" | "md" | "lg"; label?: string }) {
  const id = useId().replace(/:/g, "");
  const w = size === "sm" ? 44 : size === "lg" ? 180 : 112;
  const h = Math.round(w * 0.43);
  // Small ones sit inside buttons: they take the button's text colour so they show on any fill.
  const plane = size === "sm" ? "currentColor" : "var(--accent)";
  const trail = size === "sm" ? "currentColor" : "var(--mark)";
  return (
    <span role="status" aria-label={label} className="inline-flex flex-none" style={{ width: w, height: h }}>
      {/* In motion: the plane follows the curve, the trail grows behind it, then both fade and start again. */}
      <svg viewBox="0 0 120 52" width={w} height={h} className="motion-reduce:hidden" aria-hidden="true">
        <path id={`pf-${id}`} d={PATH} fill="none" stroke="none" />
        <path d={PATH} fill="none" stroke={trail} strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1 1">
          <animate attributeName="stroke-dashoffset" values="1;0;0" keyTimes="0;0.8;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1" />
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur="2.4s" repeatCount="indefinite" />
        </path>
        <g>
          <animateMotion dur="2.4s" repeatCount="indefinite" rotate="auto" keyPoints="0;1;1" keyTimes="0;0.8;1" calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1">
            <mpath href={`#pf-${id}`} />
          </animateMotion>
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur="2.4s" repeatCount="indefinite" />
          <Plane color={plane} />
        </g>
      </svg>
      {/* At rest, for reduced motion. */}
      <svg viewBox="0 0 120 52" width={w} height={h} className="hidden motion-reduce:block" aria-hidden="true">
        <path d={PATH} fill="none" stroke={trail} strokeWidth="3" strokeLinecap="round" strokeDasharray="5 5" />
        <g transform="translate(114 12) rotate(-38)"><Plane color={plane} /></g>
      </svg>
    </span>
  );
}
