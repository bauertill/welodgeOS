"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";

import { formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

const MAX_BYTES = 100 * 1024 * 1024;

/** "2.4 MB", "820 KB". */
const sizeInWords = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Put files on a task: each straight into the private store, then recorded on
 * the task. Returns the names of any that could not be uploaded.
 */
export async function uploadTaskFiles(
  taskId: string,
  files: File[],
  record: (input: { taskId: string; pathname: string; name: string }) => Promise<unknown>,
  onProgress: (name: string, percentage: number) => void,
) {
  const failed: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      failed.push(`${file.name} (over 100 MB)`);
      continue;
    }
    try {
      const blob = await upload(`tasks/${taskId}/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/files/upload",
        clientPayload: taskId,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => onProgress(file.name, percentage),
      });
      await record({ taskId, pathname: blob.pathname, name: file.name });
    } catch {
      failed.push(file.name);
    }
  }
  return failed;
}

/** Files chosen while writing a new task, uploaded once it is added. */
export function NewTaskFiles({ files, setFiles }: { files: File[]; setFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) setFiles([...files, ...e.dataTransfer.files]);
      }}
    >
      <span className="text-ink-700 mb-1 block text-[13px] font-medium">Files — optional</span>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2 text-[13px]">
              <span className="text-ink-900 min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-ink-500 text-xs font-light">{sizeInWords(file.size)}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, i) => i !== index))} className="text-ink-400 text-lg leading-none hover:text-[#c03654]" aria-label={`Remove ${file.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const chosen = [...(e.target.files ?? [])];
          e.target.value = "";
          setFiles([...files, ...chosen]);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="border-ink-300 text-ink-700 hover:border-brand-300 hover:text-brand-700 w-full rounded-lg border border-dashed px-4 py-2.5 text-[13px] font-light"
      >
        {files.length ? "+ Add another file" : "Attach a file — or drop it here (up to 100 MB)"}
      </button>
    </div>
  );
}

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

/** What a link is, from its address: a Google Sheet, Doc, Slides deck, Drive folder or file — else its site. */
export function linkKind(url: string): { icon: string; label: string } {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { icon: "🔗", label: "Link" };
  }
  if (host === "docs.google.com") {
    if (url.includes("/spreadsheets/")) return { icon: "📊", label: "Google Sheet" };
    if (url.includes("/document/")) return { icon: "📄", label: "Google Doc" };
    if (url.includes("/presentation/")) return { icon: "📽️", label: "Google Slides" };
    if (url.includes("/forms/")) return { icon: "📝", label: "Google Form" };
  }
  if (host === "drive.google.com") return url.includes("/folders/") ? { icon: "📁", label: "Google Drive folder" } : { icon: "📎", label: "Google Drive file" };
  return { icon: "🔗", label: host };
}

/**
 * Links on a task (the owner, 2026-11-25: "would also be super helpful to have
 * space for a google sheet or doc link"): paste one, name it if you like —
 * else it says what it is, "Google Sheet" — opened in a new tab, removable.
 */
export function TaskLinks({ taskId }: { taskId: string }) {
  const utils = api.useUtils();
  const links = api.task.links.useQuery({ taskId });
  const refresh = () => (void utils.task.links.invalidate({ taskId }), void utils.audit.invalidate());
  const add = api.task.addLink.useMutation({
    onSuccess: () => {
      setUrl("");
      setTitle("");
      refresh();
    },
  });
  const remove = api.task.removeLink.useMutation({ onSuccess: refresh });
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const rows = links.data ?? [];
  return (
    <div className="mt-4">
      {rows.length > 0 && (
        <ul className="divide-ink-200/60 mb-3 divide-y">
          {rows.map((link) => {
            const kind = linkKind(link.url);
            return (
              <li key={link.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="shrink-0" aria-hidden>
                  {kind.icon}
                </span>
                <a href={link.url} target="_blank" rel="noreferrer" className="text-ink-900 hover:text-brand-700 min-w-0 flex-1 truncate font-medium hover:underline">
                  {link.title ?? kind.label}
                </a>
                <span className="text-ink-500 shrink-0 text-xs font-light">
                  {link.title ? `${kind.label} · ` : ""}
                  {link.addedBy?.name ?? "someone"} · {formatMomentInWords(link.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => window.confirm(`Take the link "${link.title ?? kind.label}" off this task?`) && remove.mutate({ id: link.id })}
                  className="text-ink-400 shrink-0 text-lg leading-none hover:text-[#c03654]"
                  aria-label={`Remove ${link.title ?? kind.label}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add.mutate({ taskId, url: url.trim(), title: title.trim() || undefined });
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Google Sheet, Doc or any link"
          aria-label="Link"
          className="border-ink-200 focus:border-brand-400 min-w-0 flex-[2] rounded-lg border bg-white px-3 py-2 text-[13px] outline-none"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name — optional"
          aria-label="Name of the link"
          className="border-ink-200 focus:border-brand-400 min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-[13px] outline-none"
        />
        <button type="submit" disabled={add.isPending || !url.trim()} className="bg-brand-400 hover:bg-brand-500 rounded-full px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">
          {add.isPending ? "Adding…" : "Add link"}
        </button>
      </form>
      {add.error && <p className="mt-1 text-xs text-[#c03654]">{add.error.message.includes("Paste the whole link") ? "Paste the whole link — like https://docs.google.com/…" : add.error.message}</p>}
    </div>
  );
}
