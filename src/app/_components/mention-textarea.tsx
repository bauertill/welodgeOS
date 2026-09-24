"use client";

import { useRef, useState } from "react";

import { Textarea } from "~/app/_components/form";

type Person = { id: string; name: string | null; email: string | null };

const displayName = (person: Person) => person.name ?? person.email ?? "Someone";

/**
 * A `Textarea` with @mention autocomplete: typing "@" followed by letters
 * opens a dropdown of matching people, and choosing one inserts `@[Full
 * Name]` at the cursor — the literal token `~/lib/updates.tsx` renders back
 * as a highlight (doc §2.6). Mentions are plain text written at post time,
 * not a link to a live user record.
 */
export function MentionTextarea({
  value,
  onChange,
  people,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  people: Person[];
  placeholder?: string;
  rows?: number;
}) {
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);

  if (pendingCursor.current !== null && textareaRef.current) {
    const position = pendingCursor.current;
    textareaRef.current.setSelectionRange(position, position);
    pendingCursor.current = null;
  }

  const candidates = trigger
    ? people
        .filter((person) =>
          displayName(person).toLowerCase().includes(trigger.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  const updateTrigger = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = /(?:^|\s)@(\w*)$/.exec(before);
    if (match?.[1] !== undefined) {
      setTrigger({ start: cursor - match[1].length - 1, query: match[1] });
      setHighlighted(0);
    } else {
      setTrigger(null);
    }
  };

  const choose = (person: Person) => {
    if (!trigger) return;
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, trigger.start);
    const after = value.slice(cursor);
    const token = `@[${displayName(person)}] `;
    onChange(before + token + after);
    pendingCursor.current = before.length + token.length;
    setTrigger(null);
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          updateTrigger(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (!trigger || candidates.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, candidates.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const person = candidates[highlighted];
            if (person) choose(person);
          } else if (e.key === "Escape") {
            setTrigger(null);
          }
        }}
        onBlur={() => setTrigger(null)}
      />

      {trigger && candidates.length > 0 && (
        <ul className="border-ink-200/60 absolute z-20 mt-1 w-64 max-w-full overflow-y-auto rounded-lg border bg-white py-1 text-sm shadow-lg">
          {candidates.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(person)}
                className={`block w-full px-3 py-1.5 text-left ${
                  index === highlighted ? "bg-brand-400 text-white" : "hover:bg-ink-50"
                }`}
              >
                {displayName(person)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
