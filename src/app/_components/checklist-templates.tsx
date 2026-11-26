"use client";

import { useState } from "react";

import { ChecklistEditor, cleanChecklist } from "~/app/_components/checklist-editor";
import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { formatMomentInWords } from "~/lib/format";
import { readChecklist, type ChecklistSection } from "~/lib/inspections";
import { api, type RouterOutputs } from "~/trpc/react";

type Template = RouterOutputs["inspection"]["templates"][number];

/** The standard checklists (doc §6.10): list, edit in a popup, add one, choose the standard. */
export function ChecklistTemplates() {
  const templates = api.inspection.templates.useQuery();
  const utils = api.useUtils();
  const refresh = () => void utils.inspection.templates.invalidate();
  const setDefault = api.inspection.setDefaultTemplate.useMutation({ onSuccess: refresh });
  const remove = api.inspection.removeTemplate.useMutation({ onSuccess: refresh });
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setEditing("new")}>
          + New checklist
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(templates.data ?? []).map((template) => {
          const sections = readChecklist(template.sections);
          const facility = sections.filter((section) => section.kind === "facility").reduce((n, section) => n + section.items.length, 0);
          const inventory = sections.filter((section) => section.kind === "inventory").reduce((n, section) => n + section.items.length, 0);
          return (
            <div key={template.id} className="border-ink-200/60 rounded-xl border bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-ink-900 text-[15px] font-semibold">{template.name}</p>
                {template.isDefault && <span className="bg-brand-50 text-brand-700 rounded-full px-2.5 py-0.5 text-[11px] font-medium">Standard</span>}
              </div>
              <p className="text-ink-500 mt-1 text-[13px] font-light">
                {new Set(sections.map((section) => section.area)).size} areas · {facility} things to check · {inventory} items to count
              </p>
              <p className="text-ink-500 mt-1 text-[12px] font-light">
                Changed {formatMomentInWords(template.updatedAt)}
                {template.updatedBy ? ` by ${template.updatedBy.name ?? template.updatedBy.email}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
                <button type="button" onClick={() => setEditing(template)} className="text-brand-700 hover:underline">
                  Edit
                </button>
                {!template.isDefault && (
                  <>
                    <button type="button" onClick={() => setDefault.mutate({ id: template.id })} className="text-brand-700 hover:underline">
                      Make it the standard
                    </button>
                    <button type="button" onClick={() => confirm(`Remove "${template.name}"?`) && remove.mutate({ id: template.id })} className="text-[#c03654] hover:underline">
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-ink-500 text-[12px] font-light">
        The standard checklist is used for every apartment whose room type has not been adjusted. Changing it does not change inspections already planned.
      </p>
      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          copyFrom={editing === "new" ? (templates.data?.find((one) => one.isDefault) ?? null) : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ template, copyFrom, onClose, onSaved }: { template: Template | null; copyFrom: Template | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [sections, setSections] = useState<ChecklistSection[]>(readChecklist(template?.sections ?? copyFrom?.sections ?? []));
  const save = api.inspection.saveTemplate.useMutation({ onSuccess: onSaved });
  return (
    <Popup title={template ? `Edit "${template.name}"` : "New checklist"} subtitle={template ? undefined : "Starts as a copy of the standard checklist — change what you need."} onClose={onClose}>
      <div className="space-y-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="2-bedroom apartment" />
        </Field>
        <ChecklistEditor sections={sections} onChange={setSections} />
        <FormError message={save.error ? friendlyError(save.error) : null} />
        <div className="sticky bottom-0 flex justify-end gap-2 bg-ink-50/95 py-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={save.isPending || !name.trim()} onClick={() => save.mutate({ id: template?.id, name, sections: cleanChecklist(sections) })}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Popup>
  );
}
