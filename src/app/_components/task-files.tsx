"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";

import { formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

const MAX_BYTES = 100 * 1024 * 1024;

/** "2.4 MB", "820 KB". */
const sizeInWords = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Files on a task (the owner, 2026-11-18: "can we have an upload a file to a
 * task"): choose or drop one or several, up to 100 MB each; each listed with
 * who put it there and when, opened with a click, and removable. Kept in the
 * site's private file store — they open only for someone signed in.
 */
export function TaskFiles({ taskId }: { taskId: string }) {
  const utils = api.useUtils();
  const files = api.task.files.useQuery({ taskId });
  const addFile = api.task.addFile.useMutation();
  const removeFile = api.task.removeFile.useMutation({ onSuccess: () => (void utils.task.files.invalidate({ taskId }), void utils.audit.invalidate()) });
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; percentage: number }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const send = async (chosen: File[]) => {
    setProblem(null);
    const tooBig = chosen.filter((file) => file.size > MAX_BYTES);
    if (tooBig.length) setProblem(`${tooBig.map((file) => file.name).join(", ")}: larger than 100 MB, so not uploaded.`);
    const ok = chosen.filter((file) => file.size <= MAX_BYTES);
    setUploading(ok.map((file) => ({ name: file.name, percentage: 0 })));
    for (const [index, file] of ok.entries()) {
      try {
        const blob = await upload(`tasks/${taskId}/${file.name}`, file, {
          access: "private",
          handleUploadUrl: "/api/files/upload",
          clientPayload: taskId,
          multipart: file.size > 8 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => setUploading((current) => current.map((row, i) => (i === index ? { ...row, percentage } : row))),
        });
        await addFile.mutateAsync({ taskId, pathname: blob.pathname, name: file.name });
      } catch (error) {
        setProblem(`${file.name}: ${error instanceof Error ? error.message : "could not be uploaded"}.`);
      }
    }
    setUploading([]);
    void utils.task.files.invalidate({ taskId });
    void utils.audit.invalidate();
  };

  const rows = files.data ?? [];
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) void send([...e.dataTransfer.files]);
      }}
      className={`rounded-lg ${over ? "bg-brand-50 outline-brand-300 outline-2 outline-dashed" : ""}`}
    >
      {rows.length > 0 && (
        <ul className="divide-ink-200/60 mb-3 divide-y">
          {rows.map((file) => (
            <li key={file.id} className="flex items-center gap-3 py-2 text-[13px]">
              <a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" className="text-ink-900 hover:text-brand-700 min-w-0 flex-1 truncate font-medium hover:underline">
                {file.name}
              </a>
              <span className="text-ink-500 shrink-0 text-xs font-light">
                {sizeInWords(file.size)} · {file.uploadedBy?.name ?? "someone"} · {formatMomentInWords(file.createdAt)}
              </span>
              <button
                type="button"
                onClick={() => window.confirm(`Remove ${file.name}? The file is deleted.`) && removeFile.mutate({ id: file.id })}
                className="text-ink-400 shrink-0 text-lg leading-none hover:text-[#c03654]"
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading.map((row) => (
        <p key={row.name} className="text-ink-500 mb-1 text-xs font-light">
          Uploading {row.name}… {Math.round(row.percentage)}%
        </p>
      ))}
      {problem && <p className="mb-2 text-xs text-[#c03654]">{problem}</p>}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const chosen = [...(e.target.files ?? [])];
          e.target.value = "";
          if (chosen.length) void send(chosen);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={uploading.length > 0}
        className="border-ink-300 text-ink-700 hover:border-brand-300 hover:text-brand-700 w-full rounded-lg border border-dashed px-4 py-3 text-[13px] font-light disabled:opacity-60"
      >
        {uploading.length ? "Uploading…" : rows.length ? "+ Add a file — or drop it here" : "Upload a file — or drop it here (up to 100 MB)"}
      </button>
    </div>
  );
}
