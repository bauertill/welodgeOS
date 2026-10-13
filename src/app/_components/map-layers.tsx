"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { AddressSearch } from "~/app/_components/address-search";
import { friendlyError } from "~/app/_components/form";
import type { MapLayer, MapPlace } from "~/app/_components/scouting-map";
import { api } from "~/trpc/react";

const palette = ["#614fc9", "#e5533d", "#1d5fa8", "#0a7a47", "#e5a400", "#c03654", "#00838f", "#8a5a00"];

type Imported = { name: string; color: string; places: { name: string; latitude: number; longitude: number; notes: string }[] };

/**
 * A Google My Maps export (KML), read in the browser: each folder is a layer,
 * each point a place. My Maps writes a point's colour into its style's name
 * ("#icon-1899-0288D1"); lines and shapes are counted, not imported.
 */
export function readKml(text: string): { layers: Imported[]; skipped: number } {
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

type Shown = { isShown: (id: string) => boolean; toggle: (id: string) => void; showAll: () => void; hideAll: () => void };
type Point = { latitude: number; longitude: number };

/**
 * The map's Layers panel (doc §3.7), where layers are run, as in Google My
 * Maps: each ticked on or off, with our properties and Google's public
 * transport; a new layer, an import from My Maps, and on each layer's ⋯ its
 * name, colour and distance switch, its removal, and a place added — found by
 * address or picked on the map.
 */
export function LayersPanel({
  eventId,
  layers,
  places,
  shown,
  draftPoint,
  setDraftPoint,
  picking,
  setPicking,
}: {
  eventId: string;
  layers: MapLayer[];
  places: MapPlace[];
  shown: Shown;
  /** Where a new place goes, pinned on the map meanwhile. */
  draftPoint: Point | null;
  setDraftPoint: (point: Point | null) => void;
  /** The next click on the map sets the new place's spot. */
  picking: boolean;
  setPicking: (picking: boolean) => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<{ id?: string; name: string; color: string; measured: boolean } | null>(null);
  const [adding, setAdding] = useState<{ layerId: string; name: string; address: string } | null>(null);
  const [incoming, setIncoming] = useState<{ layers: Imported[]; skipped: number } | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
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
  const remove = api.mapLayer.remove.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const addPlace = api.place.create.useMutation({
    onSuccess: (place) => {
      setNote({ text: `${place.name} added.` });
      setAdding(null);
      setDraftPoint(null);
      refresh();
    },
  });
  const importLayers = api.mapLayer.importLayers.useMutation({
    onSuccess: (done) => {
      setIncoming(null);
      setNote({ text: `Imported ${done.added} ${done.added === 1 ? "place" : "places"} into ${done.layers} ${done.layers === 1 ? "layer" : "layers"}${done.skipped ? ` · ${done.skipped} already on the map, left out` : ""}.` });
      refresh();
    },
  });
  const closeAdding = () => {
    setAdding(null);
    setDraftPoint(null);
    setPicking(false);
  };

  const row = (id: string, name: string, swatch: React.ReactNode, count?: number, layer?: MapLayer) => (
    <div key={id} className="hover:bg-ink-50 group flex items-center gap-2 rounded px-1.5 py-1">
      <input type="checkbox" checked={shown.isShown(id)} onChange={() => shown.toggle(id)} className="accent-brand-500 h-3.5 w-3.5 shrink-0" aria-label={`Show ${name}`} />
      {swatch}
      <span className="text-ink-900 min-w-0 flex-1 truncate">
        {name}
        {layer?.measured && <span className="text-ink-500"> ★</span>}
      </span>
      {count !== undefined && <span className="text-ink-500 text-[11px]">{count}</span>}
      {layer && (
        <button
          type="button"
          onClick={() => {
            closeAdding();
            setEditing(editing?.id === layer.id ? null : { id: layer.id, name: layer.name, color: layer.color, measured: layer.measured });
          }}
          className="text-ink-500 hover:text-ink-900 px-1 leading-none"
          aria-label={`${layer.name}: change, or add a place`}
          title="Change the layer, or add a place to it"
        >
          ⋯
        </button>
      )}
    </div>
  );

  const layerForm = editing && (
    <div className="border-ink-200/60 bg-ink-50/50 mx-1 my-1.5 space-y-2 rounded-lg border p-2.5">
      <div className="flex gap-2">
        <input
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          placeholder="Nation houses"
          aria-label="Layer name"
          autoFocus
          className="border-ink-200 min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[12px] outline-none"
        />
        <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} aria-label="Colour" className="h-7 w-9 cursor-pointer rounded border border-ink-200 bg-white" />
      </div>
      <label className="flex items-start gap-1.5 text-[11px] leading-snug">
        <input type="checkbox" checked={editing.measured} onChange={(e) => setEditing({ ...editing, measured: e.target.checked })} className="accent-brand-500 mt-0.5 h-3.5 w-3.5" />
        Measure distances to these places, and let clients choose them as &ldquo;close to&rdquo;
      </label>
      {save.error && <p className="text-[11px] text-[#c03654]">{friendlyError(save.error)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={save.isPending || !editing.name.trim()} onClick={() => save.mutate({ eventId, ...editing })} className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 text-[11px] font-medium text-white disabled:opacity-60">
          {save.isPending ? "Saving…" : editing.id ? "Save" : "Add layer"}
        </button>
        <button type="button" onClick={() => setEditing(null)} className="text-ink-500 text-[11px] hover:underline">
          Cancel
        </button>
        {editing.id && (
          <>
            <button
              type="button"
              onClick={() => {
                setAdding({ layerId: editing.id!, name: "", address: "" });
                setEditing(null);
              }}
              className="text-brand-700 ml-auto text-[11px] font-medium hover:underline"
            >
              + Add a place
            </button>
            <button
              type="button"
              onClick={() => {
                const count = places.filter((place) => place.layerId === editing.id).length;
                if (window.confirm(`Remove the layer "${editing.name}" and its ${count} ${count === 1 ? "place" : "places"}?`)) remove.mutate({ id: editing.id! });
              }}
              className="text-[11px] text-[#c03654] hover:underline"
            >
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );

  const addForm = adding && (
    <div className="border-brand-200 bg-brand-50/60 mx-1 my-1.5 space-y-2 rounded-lg border p-2.5">
      <p className="text-ink-900 text-[11px] font-medium">New place on {layers.find((layer) => layer.id === adding.layerId)?.name}</p>
      <input
        value={adding.name}
        onChange={(e) => setAdding({ ...adding, name: e.target.value })}
        placeholder="Swiss House"
        aria-label="Place name"
        autoFocus
        className="border-ink-200 w-full rounded-md border bg-white px-2 py-1 text-[12px] outline-none"
      />
      <AddressSearch
        value={adding.address}
        onChange={(value) => setAdding({ ...adding, address: value })}
        onFound={(found) => {
          if (found.latitude === null || found.longitude === null) return;
          setAdding({ ...adding, address: found.address ?? adding.address, name: adding.name || (found.name ?? "") });
          setDraftPoint({ latitude: found.latitude, longitude: found.longitude });
        }}
      />
      <button type="button" onClick={() => setPicking(!picking)} className={`text-[11px] font-medium hover:underline ${picking ? "text-[#a35a00]" : "text-brand-700"}`}>
        {picking ? "Click the spot on the map…" : draftPoint ? "Pick another spot on the map" : "Or pick it on the map"}
      </button>
      {addPlace.error && <p className="text-[11px] text-[#c03654]">{friendlyError(addPlace.error)}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={addPlace.isPending || !adding.name.trim() || !draftPoint}
          onClick={() =>
            addPlace.mutate({
              eventId,
              layerId: adding.layerId,
              name: adding.name.trim(),
              category: "OTHER",
              address: adding.address,
              latitude: draftPoint!.latitude,
              longitude: draftPoint!.longitude,
            })
          }
          className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 text-[11px] font-medium text-white disabled:opacity-60"
        >
          {addPlace.isPending ? "Adding…" : "Add place"}
        </button>
        <button type="button" onClick={closeAdding} className="text-ink-500 text-[11px] hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="absolute top-16 left-2.5 z-10 w-64 rounded-lg bg-white text-[12px] shadow-lg">
      <button type="button" onClick={() => setOpen(!open)} className="text-ink-900 flex w-full items-center justify-between px-3 py-2 font-medium">
        Layers <span className="text-ink-500">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-ink-200/60 max-h-[26rem] overflow-y-auto border-t px-1.5 py-1.5">
          {layers.map((layer) => (
            <div key={layer.id}>
              {row(
                layer.id,
                layer.name,
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: layer.color }} />,
                places.filter((place) => place.layerId === layer.id).length,
                layer,
              )}
              {editing?.id === layer.id && layerForm}
              {adding?.layerId === layer.id && addForm}
            </div>
          ))}
          {row("properties", "Our properties", <span className="bg-brand-500 inline-block h-2.5 w-2.5 shrink-0 rounded-full" />)}
          {row("transit", "Public transport", <span className="inline-block w-2.5 shrink-0 text-center text-[10px]">🚇</span>)}
          <div className="text-brand-700 flex justify-between px-1.5 pt-1 text-[11px]">
            <button type="button" onClick={shown.showAll} className="hover:underline">
              Show all
            </button>
            <button type="button" onClick={shown.hideAll} className="hover:underline">
              Hide all
            </button>
          </div>
          {editing && !editing.id && layerForm}
          <div className="border-ink-200/60 mt-1.5 flex flex-col gap-1 border-t px-1.5 pt-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                closeAdding();
                setEditing({ name: "", color: palette[layers.length % palette.length]!, measured: false });
              }}
              className="text-brand-700 text-left font-medium hover:underline"
            >
              + New layer
            </button>
            <button type="button" onClick={() => file.current?.click()} className="text-brand-700 text-left font-medium hover:underline">
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
                setNote(null);
                if (!chosen) return;
                if (/\.kmz$/i.test(chosen.name)) return setNote({ text: "That is a KMZ file. In My Maps, export again and tick “Export as KML instead of KMZ”.", bad: true });
                try {
                  const read = readKml(await chosen.text());
                  if (!read.layers.length) return setNote({ text: "No places found in that file.", bad: true });
                  setIncoming(read);
                } catch (error) {
                  setNote({ text: error instanceof Error ? error.message : "That file could not be read.", bad: true });
                }
              }}
            />
          </div>
          {incoming && (
            <div className="border-brand-200 bg-brand-50/60 mx-1 my-1.5 rounded-lg border p-2.5 text-[11px]">
              <p className="text-ink-900 font-medium">From Google My Maps:</p>
              <ul className="mt-1 space-y-0.5">
                {incoming.layers.map((layer) => (
                  <li key={layer.name} className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: layer.color }} />
                    {layer.name} — {layer.places.length}
                  </li>
                ))}
              </ul>
              {incoming.skipped > 0 && <p className="text-ink-500 mt-1">{incoming.skipped} lines or shapes left out — only places come in.</p>}
              {importLayers.error && <p className="mt-1 text-[#c03654]">{friendlyError(importLayers.error)}</p>}
              <div className="mt-1.5 flex items-center gap-2">
                <button type="button" disabled={importLayers.isPending} onClick={() => importLayers.mutate({ eventId, layers: incoming.layers })} className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 font-medium text-white disabled:opacity-60">
                  {importLayers.isPending ? "Importing…" : "Import"}
                </button>
                <button type="button" onClick={() => setIncoming(null)} className="text-ink-500 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {note && <p className={`px-1.5 pt-1 text-[11px] ${note.bad ? "text-[#c03654]" : "text-[#0a7a47]"}`}>{note.text}</p>}
        </div>
      )}
    </div>
  );
}
