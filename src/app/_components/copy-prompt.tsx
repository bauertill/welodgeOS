"use client";

import { useState } from "react";

/** A prompt to copy into Claude, with a Copy button (doc §2.11, the site visit guide). */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="border-ink-200/60 overflow-hidden rounded-xl border bg-white">
      <div className="border-ink-200/60 bg-ink-50/60 flex items-center justify-between border-b px-4 py-2">
        <span className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">Prompt for Claude</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
          className="bg-brand-500 hover:bg-brand-600 rounded-lg px-3 py-1 text-[12px] font-medium text-white"
        >
          {copied ? "Copied ✓" : "Copy prompt"}
        </button>
      </div>
      <pre className="text-ink-800 overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">{text}</pre>
    </div>
  );
}
