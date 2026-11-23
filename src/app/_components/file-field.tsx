"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";

import { storedName } from "~/lib/file-link";
import { api } from "~/trpc/react";

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * A document field (doc §2.8, the owner 2026-11-23: Vercel Blob for files):
 * upload the file — chosen or dropped, up to 100 MB, kept in the site's
 * private store — or paste a link as before. The value is the address either
 * way, so the record keeps one field.
 */
export function FileField({
  value,
  onChange,
  placeholder = "…or paste a link",
  label = "Document",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const record = api.files.record.useMutation();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const name = storedName(value);

  const send = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (file.size > MAX_BYTES) {
      setProblem(`${file.name} is larger than 100 MB.`);
      return;
    }
    setProgress(0);
    try {
      const blob = await upload(`uploads/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/files/upload",
        clientPayload: "store",
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setProgress(percentage),
      });
      const saved = await record.mutateAsync({ pathname: blob.pathname, name: file.name });
      onChange(saved.url);
    } catch (error) {
      setProblem(error instanceof Error && error.message ? `Not uploaded: ${error.message}` : "The file could not be uploaded — try again.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div
      className={`min-w-56 flex-1 ${className}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label={`Upload ${label.toLowerCase()}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void send(file);
        }}
      />
      {name ? (
        <div className="border-ink-200 flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-[13px]">
          <a href={value} target="_blank" rel="noreferrer" className="text-brand-700 min-w-0 flex-1 truncate font-medium hover:underline">
            📎 {name}
          </a>
          <button type="button" onClick={() => onChange("")} className="text-ink-400 text-lg leading-none hover:text-[#c03654]" aria-label={`Remove ${name}`}>
            ×
          </button>
        </div>
      ) : (
        <div className={`flex items-center gap-2 rounded-lg ${over ? "ring-brand-300 ring-2" : ""}`}>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={progress !== null}
            className="border-ink-300 text-ink-700 hover:border-brand-300 hover:text-brand-700 shrink-0 rounded-lg border border-dashed px-3 py-2 text-[13px] whitespace-nowrap"
          >
            {progress !== null ? `Uploading… ${Math.round(progress)}%` : "📎 Upload file"}
          </button>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={`${label} — link`}
            className="border-ink-200 focus:border-brand-400 min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-[13px] outline-none"
          />
        </div>
      )}
      {problem && <p className="mt-1 text-xs text-[#c03654]">{problem}</p>}
    </div>
  );
}
