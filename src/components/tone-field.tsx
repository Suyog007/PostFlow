"use client";

// "How you sound": a few ready-made voices to start from, and a box to say it in your own words.

import { useState } from "react";

const PRESETS = [
  { label: "Friendly and simple", text: "Friendly and simple. Short sentences, everyday words, like explaining it to a smart friend. No jargon, no hype." },
  { label: "Expert and precise", text: "Expert and precise. Specific facts and numbers, a clear point of view, calm and confident. No hype." },
  { label: "Short and punchy", text: "Short and punchy. One idea per line, strong first line, no filler words. No hype." },
  { label: "Warm and personal", text: "Warm and personal. First person, a little story or feeling where it fits, kind and encouraging. No hype." },
];

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
            className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${value === p.text ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line-strong)] hover:border-[var(--ink)]"}`}
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
