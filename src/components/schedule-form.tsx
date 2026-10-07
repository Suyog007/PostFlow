"use client";

import { useState } from "react";
import { ActionForm } from "./client";
import { scheduleAction, rescheduleAction } from "@/app/actions";

export function ScheduleForm({
  draftId,
  suggestion,
  suggestionReason,
  minLocal,
  platformLabel,
  paused,
}: {
  draftId: string;
  suggestion: string | null;
  suggestionReason: string | null;
  minLocal: string;
  platformLabel: string;
  paused: boolean;
}) {
  const [mode, setMode] = useState<"suggested" | "pick" | "now" | "hold">(suggestion ? "suggested" : "pick");
  return (
    <ActionForm action={scheduleAction} className="space-y-3" pendingText={mode === "now" ? "Publishing…" : "Scheduling…"}>
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="mode" value={mode === "now" ? "now" : "at"} />
      {suggestion && (
        <label className="flex cursor-pointer gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
          <input type="radio" checked={mode === "suggested"} onChange={() => setMode("suggested")} className="mt-1" />
          <span>
            <span className="font-medium">Schedule for the suggested time</span>
            <span className="block text-xs text-muted">{suggestionReason}</span>
          </span>
        </label>
      )}
      <label className="flex cursor-pointer gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
        <input type="radio" checked={mode === "pick"} onChange={() => setMode("pick")} className="mt-1" />
        <span className="flex-1">
          <span className="font-medium">Choose a date and time</span>
          {mode === "pick" && <input type="datetime-local" name="at" min={minLocal} defaultValue={suggestion ?? minLocal} className="input mt-2" required />}
        </span>
      </label>
      {mode === "suggested" && suggestion && <input type="hidden" name="at" value={suggestion} />}
      <label className="flex cursor-pointer gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
        <input type="radio" checked={mode === "now"} onChange={() => setMode("now")} className="mt-1" />
        <span>
          <span className="font-medium">Publish now to {platformLabel}</span>
          {paused && <span className="block text-xs text-warn">{platformLabel} publishing is paused.</span>}
        </span>
      </label>
      <label className="flex cursor-pointer gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
        <input type="radio" checked={mode === "hold"} onChange={() => setMode("hold")} className="mt-1" />
        <span>
          <span className="font-medium">Keep approved, schedule later</span>
          <span className="block text-xs text-muted">It stays in your approved queue.</span>
        </span>
      </label>
      {mode !== "hold" && (
        <button type="submit" className="btn-primary w-full">
          {mode === "now" ? `Publish to ${platformLabel} now` : "Schedule"}
        </button>
      )}
    </ActionForm>
  );
}

export function RescheduleForm({ scheduledPostId, current, minLocal }: { scheduledPostId: string; current: string; minLocal: string }) {
  return (
    <ActionForm action={rescheduleAction} className="flex flex-wrap items-end gap-2" pendingText="Saving…">
      <input type="hidden" name="scheduledPostId" value={scheduledPostId} />
      <div className="flex-1">
        <label className="label">New time</label>
        <input type="datetime-local" name="at" min={minLocal} defaultValue={current} className="input" required />
      </div>
      <button type="submit" className="btn-secondary">
        Reschedule
      </button>
    </ActionForm>
  );
}
