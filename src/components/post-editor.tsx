"use client";

import { useState } from "react";
import { editPostAction } from "@/app/actions";
import { weightedLength } from "@/server/checks";
import { PostPreview } from "./post-preview";
import { Icon } from "./ui";

export function PostEditor({ id, platform, initialText, name, role, handle, editable }: { id: string; platform: string; initialText: string; name: string; role: string; handle: string; editable: boolean }) {
  const [text, setText] = useState(initialText);
  const len = weightedLength(text);
  const limit = platform === "x" ? 280 : 3000;
  const over = len > limit;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <form action={editPostAction} className="panel">
        <input type="hidden" name="id" value={id} />
        <div className="panel-head"><Icon name="pencil" size={15} />Post text</div>
        <div className="panel-body space-y-2">
          <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} rows={platform === "x" ? 6 : 15} className="textarea post-text" aria-label="Post text" />
          <div className="flex items-center gap-2">
            {editable && <button className="btn btn-primary btn-sm" disabled={over || text.trim() === initialText.trim()}>Save my wording</button>}
            <span className={`tnum ml-auto text-[12px] ${over ? "text-[var(--bad)]" : "text-[var(--subtle)]"}`}>{len} / {limit}</span>
          </div>
          {editable && <p className="hint">Edited posts skip the reviewer. Your wording is posted exactly as written.</p>}
        </div>
      </form>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-[var(--muted)]">Preview</div>
        <PostPreview platform={platform} name={name} role={role} handle={handle} text={text} />
      </div>
    </div>
  );
}
