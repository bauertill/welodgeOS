"use client";

import { useState } from "react";

import { Dialog } from "~/app/_components/dialog";
import { Button, Field, FormError, friendlyError, Input, Select } from "~/app/_components/form";
import { formatUntil } from "~/lib/format";
import {
  clearAfterChoices,
  customStatusMaxLength,
  customStatusPresets,
  defaultEmoji,
  emojiChoices,
  untilFor,
  type ClearAfter,
  type CustomStatus,
} from "~/lib/team";
import { api } from "~/trpc/react";

/** "2026-09-27T13:30", the shape a datetime-local field reads and writes, in local time. */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "Your status" (doc §2.7): a status in your own words with an emoji, and when
 * it should stop showing. Offers a few common ones to pick with one click.
 */
export function CustomStatusDialog({
  current,
  onClose,
}: {
  current: CustomStatus | null;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const [emoji, setEmoji] = useState(current?.emoji ?? defaultEmoji);
  const [text, setText] = useState(current?.text ?? "");
  const [clearAfter, setClearAfter] = useState<ClearAfter>(
    current ? (current.until ? "custom" : "never") : "today",
  );
  const [customUntil, setCustomUntil] = useState(
    toLocalInput(current?.until ?? new Date(Date.now() + 60 * 60_000)),
  );
  const [pickingEmoji, setPickingEmoji] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = api.user.setCustomStatus.useMutation({
    onSuccess: () => {
      void utils.user.invalidate();
      void utils.chat.invalidate();
      onClose();
    },
  });

  const submit = () => {
    setProblem(null);
    let until: Date | null;
    if (clearAfter === "custom") {
      until = new Date(customUntil);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        setProblem("Choose a time that is still to come.");
        return;
      }
    } else {
      until = untilFor(clearAfter);
    }
    save.mutate({ emoji, text, until });
  };

  const choosePreset = (preset: (typeof customStatusPresets)[number]) => {
    setEmoji(preset.emoji);
    setText(preset.text);
    setClearAfter(preset.clearAfter);
  };

  return (
    <Dialog title="Your status" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickingEmoji((value) => !value)}
              aria-expanded={pickingEmoji}
              aria-label={`Emoji: ${emoji}. Choose another`}
              className="border-ink-200 hover:bg-ink-50 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xl"
            >
              {emoji}
            </button>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={customStatusMaxLength}
              placeholder="Write your own"
              aria-label="Your status"
              autoFocus
            />
          </div>
          <p className="text-ink-500 mt-1 text-right text-[11px] font-light">
            {text.length}/{customStatusMaxLength}
          </p>

          {pickingEmoji && (
            <div className="border-ink-200/60 mt-1 grid grid-cols-8 gap-1 rounded-lg border p-2">
              {emojiChoices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => {
                    setEmoji(choice);
                    setPickingEmoji(false);
                  }}
                  aria-label={choice}
                  className={`hover:bg-ink-50 rounded-md p-1 text-xl ${choice === emoji ? "bg-brand-50" : ""}`}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>

        {!text && (
          <ul className="space-y-0.5">
            {customStatusPresets.map((preset) => (
              <li key={preset.text}>
                <button
                  type="button"
                  onClick={() => choosePreset(preset)}
                  className="hover:bg-ink-50 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left"
                >
                  <span className="text-xl">{preset.emoji}</span>
                  <span className="text-ink-900 flex-1 text-sm font-light">{preset.text}</span>
                  <span className="text-ink-500 text-xs font-light">
                    {clearAfterChoices.find((choice) => choice.key === preset.clearAfter)?.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {text && (
          <div className="space-y-3">
            <Field label="Clear status after">
              <Select value={clearAfter} onChange={(e) => setClearAfter(e.target.value as ClearAfter)}>
                {clearAfterChoices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>
            {clearAfter === "custom" && (
              <Field label="Clear at">
                <Input
                  type="datetime-local"
                  value={customUntil}
                  min={toLocalInput(new Date())}
                  onChange={(e) => setCustomUntil(e.target.value)}
                />
              </Field>
            )}
          </div>
        )}

        <FormError message={problem ?? friendlyError(save.error)} />
        <div className="flex items-center justify-between gap-2">
          {current ? (
            <Button
              type="button"
              variant="ghost"
              className="px-0"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Clear status
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim() || save.isPending}>
              Done
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** A colleague's own-words status, as it sits beside or under their name. */
export function CustomStatusText({
  status,
  showUntil = false,
  className = "",
}: {
  status: CustomStatus | null;
  showUntil?: boolean;
  className?: string;
}) {
  if (!status) return null;
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 ${className}`}
      title={`${status.text}${status.until ? ` (${formatUntil(status.until)})` : ""}`}
    >
      <span aria-hidden="true">{status.emoji}</span>
      <span className="truncate">{status.text}</span>
      {showUntil && status.until && (
        <span className="text-ink-500 shrink-0">· {formatUntil(status.until)}</span>
      )}
    </span>
  );
}
