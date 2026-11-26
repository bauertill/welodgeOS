"use client";

import { newId, type ChecklistSection } from "~/lib/inspections";

/**
 * An inspection checklist, edited (doc §6.10): area by area, what should work
 * (facility) and what should be there and how many (inventory). Used for the
 * standard checklists and for a room type's own.
 */
export function ChecklistEditor({ sections, onChange }: { sections: ChecklistSection[]; onChange: (sections: ChecklistSection[]) => void }) {
  const set = (id: string, change: (section: ChecklistSection) => ChecklistSection) => onChange(sections.map((section) => (section.id === id ? change(section) : section)));
  const move = (id: string, by: -1 | 1) => {
    const index = sections.findIndex((section) => section.id === id);
    const to = index + by;
    if (to < 0 || to >= sections.length || sections[to]!.kind !== sections[index]!.kind) return;
    const next = [...sections];
    [next[index], next[to]] = [next[to]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-6">
      {(["facility", "inventory"] as const).map((kind) => {
        const list = sections.filter((section) => section.kind === kind);
        return (
          <div key={kind} className="space-y-3">
            <div>
              <p className="text-ink-900 text-[15px] font-semibold">{kind === "facility" ? "Facility check" : "Inventory list"}</p>
              <p className="text-ink-500 text-xs font-light">
                {kind === "facility" ? "What should work — ticked yes or no on the day." : "What should be there, and how many — counted on the day. Leave the number empty to just count it."}
              </p>
            </div>
            {list.map((section, index) => (
              <div key={section.id} className="border-ink-200/70 rounded-xl border bg-white p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={section.area}
                    onChange={(e) => set(section.id, (one) => ({ ...one, area: e.target.value }))}
                    placeholder="Area — Kitchen, Bedroom 2…"
                    aria-label="Area"
                    className="text-ink-900 border-ink-200 focus:border-brand-400 min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium outline-none"
                  />
                  <button type="button" disabled={index === 0} onClick={() => move(section.id, -1)} className="text-ink-500 hover:text-brand-700 px-1 text-sm disabled:opacity-30" aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" disabled={index === list.length - 1} onClick={() => move(section.id, 1)} className="text-ink-500 hover:text-brand-700 px-1 text-sm disabled:opacity-30" aria-label="Move down">
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(sections.filter((one) => one.id !== section.id))}
                    className="text-[12px] text-[#c03654] hover:underline"
                  >
                    Remove area
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {section.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <input
                        value={item.label}
                        onChange={(e) => set(section.id, (one) => ({ ...one, items: one.items.map((it) => (it.id === item.id ? { ...it, label: e.target.value } : it)) }))}
                        placeholder={kind === "facility" ? "Shower works" : "Knives"}
                        aria-label="Item"
                        className="border-ink-200 focus:border-brand-400 min-w-0 flex-1 rounded-lg border px-2.5 py-1 text-[13px] font-light outline-none"
                      />
                      {kind === "inventory" && (
                        <input
                          type="number"
                          min={0}
                          value={item.expected ?? ""}
                          onChange={(e) =>
                            set(section.id, (one) => ({
                              ...one,
                              items: one.items.map((it) => (it.id === item.id ? { ...it, expected: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) } : it)),
                            }))
                          }
                          placeholder="#"
                          aria-label="How many"
                          className="border-ink-200 focus:border-brand-400 w-16 rounded-lg border px-2 py-1 text-right text-[13px] outline-none"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => set(section.id, (one) => ({ ...one, items: one.items.filter((it) => it.id !== item.id) }))}
                        className="text-ink-500 px-1 text-[15px] hover:text-[#c03654]"
                        aria-label={`Remove ${item.label}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => set(section.id, (one) => ({ ...one, items: [...one.items, { id: newId(), label: "", expected: kind === "inventory" ? 1 : null }] }))}
                  className="text-brand-700 mt-2 text-[12px] hover:underline"
                >
                  + Add item
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange([...sections, { id: newId(), kind, area: "", items: [{ id: newId(), label: "", expected: kind === "inventory" ? 1 : null }] }])}
              className="border-ink-200 text-brand-700 hover:border-brand-400 w-full rounded-xl border border-dashed py-2 text-[13px]"
            >
              + Add an area to the {kind === "facility" ? "facility check" : "inventory"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Empty areas and nameless items left out before saving. */
export const cleanChecklist = (sections: ChecklistSection[]) =>
  sections
    .map((section) => ({ ...section, area: section.area.trim(), items: section.items.map((item) => ({ ...item, label: item.label.trim() })).filter((item) => item.label) }))
    .filter((section) => section.area && section.items.length);
