"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A searchable dropdown: type to filter, click or press Enter to choose.
 * Stands in for a plain `<select>` wherever the option list can run into the
 * hundreds — a property or client picker on a large event — where scrolling
 * a long list stops being usable.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: {
  /** The chosen option's id, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  /** Shown when nothing is chosen, and as the "clear" option in the list. */
  placeholder: string;
  className?: string;
}) {
  const selected = options.find((o) => o.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // While closed, the input shows the chosen label (or nothing, falling back
  // to the placeholder) — typing only replaces it once the field is opened.
  const displayValue = open ? query : (selected?.label ?? "");

  const filtered = query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  const choose = (id: string) => {
    onChange(id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      className={`relative ${className}`}
      onBlur={() => {
        setOpen(false);
        setQuery("");
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onFocus={(e) => {
          setOpen(true);
          setQuery("");
          e.target.select();
        }}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const option = filtered[highlighted];
            if (option) choose(option.id);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            inputRef.current?.blur();
          }
        }}
        className="border-ink-200 focus:border-brand-400 focus:ring-brand-400/20 w-full rounded-lg border bg-white px-3 py-2 text-sm font-light outline-none transition-colors focus:ring-4"
      />

      {open && (
        <ul className="border-ink-200/60 absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-white py-1 text-sm shadow-lg">
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose("")}
              className={`text-ink-500 hover:bg-ink-50 block w-full px-3 py-1.5 text-left font-light ${
                value === "" ? "bg-ink-50" : ""
              }`}
            >
              {placeholder}
            </button>
          </li>
          {filtered.length === 0 ? (
            <li className="text-ink-400 px-3 py-1.5 text-xs font-light">
              No matches
            </li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option.id)}
                  className={`block w-full px-3 py-1.5 text-left ${
                    index === highlighted
                      ? "bg-brand-400 text-white"
                      : "hover:bg-ink-50"
                  } ${option.id === value ? "font-medium" : "font-light"}`}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
