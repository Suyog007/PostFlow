"use client";

// "How you sound": a few ready-made voices to start from, and a box to say it in your own words.

import { useState } from "react";
import { TONES as PRESETS } from "@/lib/tones";


export function ToneField({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <label htmlFor="tone" className="label">How you sound</label>
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Pick a voice to start from">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={value === p.text}
            onClick={() => setValue(p.text)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${value === p.text ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line-strong)] hover:border-[var(--accent)]"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea id="tone" name={name} rows={3} value={value} onChange={(e) => setValue(e.target.value)} className="textarea" />
      <span className="hint mt-1 block">Pick one to start, then change the words as you like. To add the source link to posts, use the switch under &ldquo;What every post includes&rdquo; below.</span>
    </div>
  );
}
