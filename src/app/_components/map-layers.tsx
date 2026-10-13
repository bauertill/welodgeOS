"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { api } from "~/trpc/react";

const palette = ["#614fc9", "#e5533d", "#1d5fa8", "#0a7a47", "#e5a400", "#c03654", "#00838f", "#8a5a00"];

type Imported = { name: string; color: string; places: { name: string; latitude: number; longitude: number; notes: string }[] };

/**
 * A Google My Maps export (KML), read in the browser: each folder is a layer,
 * each point a place. My Maps writes a point's colour into its style's name
 * ("#icon-1899-0288D1"); lines and shapes are counted, not imported.
 */
function readKml(text: string): { layers: Imported[]; skipped: number } {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("That file could not be read as KML.");
  const direct = (element: Element, tag: string) => Array.from(element.children).find((child) => child.localName === tag) ?? null;
  const textOf = (element: Element | null) => element?.textContent?.trim() ?? "";
  let skipped = 0;
  const layerFrom = (container: Element, fallbackName: string, index: number): Imported => {
    const placemarks = Array.from(container.getElementsByTagName("Placemark"));
    let color: string | null = null;
    const places = placemarks.flatMap((placemark) => {
      const point = placemark.getElementsByTagName("Point")[0];
      if (!point) {
        skipped++;
        return [];
      }
      const [lng, lat] = textOf(point.getElementsByTagName("coordinates")[0] ?? null).split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        skipped++;
        return [];
      }
      const style = /([0-9A-Fa-f]{6})(?:-[a-z]+)?$/.exec(textOf(direct(placemark, "styleUrl")));
      if (!color && style) color = `#${style[1]!.toLowerCase()}`;
      const description = textOf(direct(placemark, "description")).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
      return [{ name: textOf(direct(placemark, "name")) || "Unnamed place", latitude: lat!, longitude: lng!, notes: description.slice(0, 5000) }];
    });
    return { name: (textOf(direct(container, "name")) || fallbackName).slice(0, 100), color: color ?? palette[index % palette.length]!, places };
  };
  const folders = Array.from(doc.getElementsByTagName("Folder"));
  const documentEl = doc.getElementsByTagName("Document")[0] ?? doc.documentElement;
  const layers = folders.length
    ? folders.map((folder, index) => layerFrom(folder, `Layer ${index + 1}`, index))
    : [layerFrom(documentEl, "Imported places", 0)];
  return { layers: layers.filter((layer) => layer.places.length > 0), skipped };
}

/**
 * The event's map layers (doc §3.7), on its Event details tab: each with its
 * colour, its places and whether distances are measured to it — added,
 * changed, removed, or imported from Google My Maps.
 */
export function MapLayersCard({ eventId }: { eventId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const layers = api.mapLayer.listForEvent.useQuery({ eventId });
  const [editing, setEditing] = useState<{ id?: string; name: string; color: string; measured: boolean } | null>(null);
  const [incoming, setIncoming] = useState<{ layers: Imported[]; skipped: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => {
    void utils.mapLayer.invalidate();
    void utils.place.invalidate();
    router.refresh();
  };
  const save = api.mapLayer.save.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = api.mapLayer.remove.useMutation({ onSuccess: refresh });
  const importLayers = api.mapLayer.importLayers.useMutation({
    onSuccess: (done) => {
      setIncoming(null);
      setResult(`Imported ${done.added} ${done.added === 1 ? "place" : "places"} into ${done.layers} ${done.layers === 1 ? "layer" : "layers"}${done.skipped ? ` · ${done.skipped} already on the map, left out` : ""}.`);
      refresh();
    },
  });
  const list = layers.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Map layers</h2>
        <span className="flex items-center gap-4 text-[13px]">
          <button type="button" onClick={() => setEditing({ name: "", color: palette[list.length % palette.length]!, measured: false })} className="text-brand-700 hover:underline">
            + New layer
          </button>
          <button type="button" onClick={() => file.current?.click()} className="text-brand-700 hover:underline">
            Import from Google My Maps
          </button>
          <input
            ref={file}
            type="file"
            accept=".kml,application/vnd.google-earth.kml+xml"
            className="hidden"
            onChange={async (event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              setProblem(null);
              setResult(null);
              if (!chosen) return;
              if (/\.kmz$/i.test(chosen.name)) return setProblem("That is a KMZ file. In My Maps, export again and tick “Export to a .KML file” — then upload that.");
              try {
                const read = readKml(await chosen.text());
                if (!read.layers.length) return setProblem("No places found in that file.");
                setIncoming(read);
              } catch (error) {
                setProblem(error instanceof Error ? error.message : "That file could not be read.");
              }
            }}
          />
        </span>
      </div>

      {list.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">No layers yet. Add one, or import your Google My Maps.</p>
      ) : (
        <ul className="divide-ink-200/60 divide-y text-sm">
          {list.map((layer) => (
            <li key={layer.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color }} />
              <span className="text-ink-900 font-medium">{layer.name}</span>
              <span className="text-ink-500 text-xs font-light">
                {layer._count.places} {layer._count.places === 1 ? "place" : "places"}
              </span>
              {layer.measured && <span className="bg-brand-50 text-brand-800 rounded-full px-2 py-0.5 text-[11px] font-medium">Distances measured</span>}
              <span className="ml-auto flex gap-3 text-xs">
                <button type="button" onClick={() => setEditing({ id: layer.id, name: layer.name, color: layer.color, measured: layer.measured })} className="text-brand-700 hover:underline">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() =>
                    window.confirm(`Remove the layer "${layer.name}" and its ${layer._count.places} ${layer._count.places === 1 ? "place" : "places"}?`) && remove.mutate({ id: layer.id })
                  }
                  className="text-[#c03654] hover:underline"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="border-ink-200/60 bg-ink-50/40 mt-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <Field label="Layer name">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Nation houses" autoFocus />
            </Field>
            <Field label="Colour">
              <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-10 w-full cursor-pointer rounded-lg border border-ink-200 bg-white" />
            </Field>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={editing.measured} onChange={(e) => setEditing({ ...editing, measured: e.target.checked })} className="accent-brand-500 h-4 w-4" />
            Measure distances to these places — and let clients choose them as &ldquo;close to&rdquo;
          </label>
          <FormError message={save.error ? friendlyError(save.error) : null} />
          <div className="mt-3 flex gap-2">
            <Button type="button" disabled={save.isPending || !editing.name.trim()} onClick={() => save.mutate({ eventId, ...editing })}>
              {save.isPending ? "Saving…" : editing.id ? "Save" : "Add layer"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {incoming && (
        <div className="border-brand-200 bg-brand-50/60 mt-3 rounded-lg border p-3 text-[13px]">
          <p className="text-ink-900 font-medium">From Google My Maps:</p>
          <ul className="mt-1 space-y-0.5">
            {incoming.layers.map((layer) => (
              <li key={layer.name} className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: layer.color }} />
                {layer.name} — {layer.places.length} {layer.places.length === 1 ? "place" : "places"}
              </li>
            ))}
          </ul>
          {incoming.skipped > 0 && (
            <p className="text-ink-500 mt-1 text-xs font-light">
              {incoming.skipped} lines or shapes left out — only places (points) come in. Metro lines are on the map as Google&apos;s Public transport.
            </p>
          )}
          <FormError message={importLayers.error ? friendlyError(importLayers.error) : null} />
          <div className="mt-2 flex gap-2">
            <Button type="button" disabled={importLayers.isPending} onClick={() => importLayers.mutate({ eventId, layers: incoming.layers })}>
              {importLayers.isPending ? "Importing…" : "Import"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIncoming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && <p className="mt-2 text-xs text-[#c03654]">{problem}</p>}
      {result && <p className="mt-2 text-xs text-[#0a7a47]">{result}</p>}
    </div>
  );
}
