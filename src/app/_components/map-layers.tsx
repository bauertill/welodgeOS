"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { AddressSearch } from "~/app/_components/address-search";
import { friendlyError } from "~/app/_components/form";
import type { MapLayer, MapPlace } from "~/app/_components/scouting-map";
import { api } from "~/trpc/react";

const palette = ["#614fc9", "#e5533d", "#1d5fa8", "#0a7a47", "#e5a400", "#c03654", "#00838f", "#8a5a00"];

type Imported = { name: string; color: string; places: { name: string; latitude: number | null; longitude: number | null; address: string; notes: string }[] };

/**
 * A Google My Maps export (KML), read in the browser: each folder is a layer,
 * each point a place. My Maps writes a point's colour into its style's name
 * ("#icon-1899-0288D1"); lines and shapes are counted, not imported. A point
 * with no position of its own (a layer built from a spreadsheet) takes the
 * one in its WKT column, or else comes with its address, to be found by it.
 */
export function readKml(text: string): { layers: Imported[]; skipped: number; byAddress: number; unlocated: number } {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("That file could not be read as KML.");
  const direct = (element: Element, tag: string) => Array.from(element.children).find((child) => child.localName === tag) ?? null;
  const textOf = (element: Element | null) => element?.textContent?.trim() ?? "";
  let skipped = 0;
  let byAddress = 0;
  let unlocated = 0;
  const layerFrom = (container: Element, fallbackName: string, index: number): Imported => {
    const placemarks = Array.from(container.getElementsByTagName("Placemark"));
    let color: string | null = null;
    const places = placemarks.flatMap((placemark) => {
      if (placemark.getElementsByTagName("LineString").length || placemark.getElementsByTagName("Polygon").length) {
        skipped++;
        return [];
      }
      const data = new Map(
        Array.from(placemark.getElementsByTagName("Data")).map((one) => [(one.getAttribute("name") ?? "").toLowerCase(), textOf(one.getElementsByTagName("value")[0] ?? null)] as const),
      );
      const point = placemark.getElementsByTagName("Point")[0];
      let [lng, lat] = point ? textOf(point.getElementsByTagName("coordinates")[0] ?? null).split(",").map(Number) : [NaN, NaN];
      const wkt = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(data.get("wkt") ?? "");
      if (!(Number.isFinite(lat) && Number.isFinite(lng)) && wkt) [lng, lat] = [Number(wkt[1]), Number(wkt[2])];
      const located = Number.isFinite(lat) && Number.isFinite(lng);
      const address = (data.get("address") || "").slice(0, 500);
      if (!located) {
        if (address) byAddress++;
        else {
          unlocated++;
          return [];
        }
      }
      const style = /([0-9A-Fa-f]{6})(?:-[a-z]+)?$/.exec(textOf(direct(placemark, "styleUrl")));
      if (!color && style) color = `#${style[1]!.toLowerCase()}`;
      // Its description, without the empty "Name: " lines a spreadsheet layer leaves.
      const description = textOf(direct(placemark, "description"))
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^[^:]{1,40}:$/.test(line) && !/^wkt:/i.test(line))
        .join("\n");
      return [{ name: (textOf(direct(placemark, "name")) || "Unnamed place").slice(0, 200), latitude: located ? lat! : null, longitude: located ? lng! : null, address, notes: description.slice(0, 5000) }];
    });
    return { name: (textOf(direct(container, "name")) || fallbackName).slice(0, 100), color: color ?? palette[index % palette.length]!, places };
  };
  const folders = Array.from(doc.getElementsByTagName("Folder"));
  const documentEl = doc.getElementsByTagName("Document")[0] ?? doc.documentElement;
  const layers = folders.length
    ? folders.map((folder, index) => layerFrom(folder, `Layer ${index + 1}`, index))
    : [layerFrom(documentEl, "Imported places", 0)];
  return { layers: layers.filter((layer) => layer.places.length > 0), skipped, byAddress, unlocated };
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
  propertyCounts,
  draftPoint,
  setDraftPoint,
  picking,
  setPicking,
}: {
  eventId: string;
  layers: MapLayer[];
  places: MapPlace[];
  shown: Shown;
  /** Properties on the map: contracted, and every other as Hotels or Apartments. */
  propertyCounts?: { contracted: number; hotels: number; apartments: number };
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
  const [incoming, setIncomingRaw] = useState<ReturnType<typeof readKml> | null>(null);
  // What of it is ours already — and, of those, which to leave out (ticked).
  const check = api.mapLayer.checkImport.useMutation({
    onSuccess: ({ matches }) => setLeaveOut(new Set(matches.filter((one) => one.against !== "library").map((one) => one.key))),
  });
  const [leaveOut, setLeaveOut] = useState<Set<string>>(new Set());
  const [showMatches, setShowMatches] = useState(false);
  const setIncoming = (read: ReturnType<typeof readKml> | null) => {
    setIncomingRaw(read);
    check.reset();
    setLeaveOut(new Set());
    setShowMatches(false);
    if (read) check.mutate({ eventId, layers: read.layers });
  };
  const [link, setLink] = useState<string | null>(null);
  const fetchMyMaps = api.mapLayer.fetchMyMaps.useMutation({
    onSuccess: ({ kml }) => {
      try {
        const read = readKml(kml);
        if (!read.layers.length) return setNote({ text: "No places found on that map.", bad: true });
        setLink(null);
        setIncoming(read);
      } catch (error) {
        setNote({ text: error instanceof Error ? error.message : "That map could not be read.", bad: true });
      }
    },
  });
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
      setNote({
        text: `Imported ${done.added} ${done.added === 1 ? "point" : "points"} into ${done.layers} ${done.layers === 1 ? "layer" : "layers"} — on the map only, nothing added to the properties board${done.skipped ? ` · ${done.skipped} already on the map, left out` : ""}${done.properties ? ` · ${done.properties} already on the properties board, left out` : ""}${done.found ? ` · ${done.found} placed by their address` : ""}${done.unlocated ? ` · ${done.unlocated} could not be placed` : ""}.`,
      });
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
          {row("contracted", "Contracted", <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border-2 border-[#0a7a47] bg-white" />, propertyCounts?.contracted)}
          {row("hotels", "Hotels", <span className="border-ink-300 inline-block h-2.5 w-2.5 shrink-0 rounded-sm border-2 bg-white" />, propertyCounts?.hotels)}
          {row("apartments", "Apartments", <span className="border-ink-300 inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-white" />, propertyCounts?.apartments)}
          {row("transit", "Google public transport", <span className="inline-block w-2.5 shrink-0 text-center text-[10px]">🚇</span>)}
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
            <button type="button" onClick={() => setLink((now) => (now === null ? "" : null))} className="text-brand-700 text-left font-medium hover:underline">
              Import from Google My Maps
            </button>
            {link !== null && (
              <div className="border-ink-200/60 rounded-lg border bg-white p-2">
                <p className="text-ink-500 mb-1">Paste the map&rsquo;s link — shared so anyone with it can view:</p>
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setNote(null);
                    fetchMyMaps.mutate({ url: link });
                  }}
                >
                  <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.google.com/maps/d/…?mid=…" className="border-ink-200 min-w-0 flex-1 rounded border px-1.5 py-1" autoFocus />
                  <button type="submit" disabled={fetchMyMaps.isPending || !link.trim()} className="bg-brand-400 hover:bg-brand-500 rounded px-2 font-medium text-white disabled:opacity-60">
                    {fetchMyMaps.isPending ? "Reading…" : "Read"}
                  </button>
                </form>
                {fetchMyMaps.error && <p className="mt-1 text-[#c03654]">{friendlyError(fetchMyMaps.error)}</p>}
                <button type="button" onClick={() => file.current?.click()} className="text-ink-500 mt-1 hover:underline">
                  …or upload a KML file exported from My Maps
                </button>
              </div>
            )}
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
              <p className="text-ink-500 mt-1">Every point goes on the map only — nothing is added to the properties board. A hotel can be added to it later from its pin.</p>
              {incoming.byAddress > 0 && <p className="text-ink-500 mt-1">{incoming.byAddress} have only an address — they are placed by it (about a second each).</p>}
              {incoming.unlocated > 0 && <p className="text-ink-500 mt-1">{incoming.unlocated} have no position or address — left out.</p>}
              {incoming.skipped > 0 && <p className="text-ink-500 mt-1">{incoming.skipped} lines or shapes left out — only points come in.</p>}
              {check.isPending && <p className="text-ink-500 mt-1.5">Checking what is on our map and in our properties already…</p>}
              {check.error && <p className="mt-1 text-[#c03654]">{friendlyError(check.error)}</p>}
              {check.data && (
                <div className="border-ink-200/60 mt-1.5 rounded border bg-white p-1.5">
                  {check.data.matches.length === 0 ? (
                    <p className="text-[#0a7a47]">Nothing in it is ours already.</p>
                  ) : (
                    <>
                      <p className="text-ink-900">
                        <span className="font-medium">{check.data.matches.length} look like what we have</span> — {leaveOut.size} ticked to leave out.{" "}
                        <button type="button" onClick={() => setShowMatches(!showMatches)} className="text-brand-700 hover:underline">
                          {showMatches ? "Hide" : "See them"}
                        </button>
                      </p>
                      {showMatches && (
                        <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto">
                          {check.data.matches.map((one) => (
                            <li key={one.key}>
                              <label className="flex items-start gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={leaveOut.has(one.key)}
                                  onChange={() =>
                                    setLeaveOut((now) => {
                                      const next = new Set(now);
                                      if (next.has(one.key)) next.delete(one.key);
                                      else next.add(one.key);
                                      return next;
                                    })
                                  }
                                  className="accent-brand-500 mt-0.5 h-3 w-3 shrink-0"
                                />
                                <span>
                                  <span className="text-ink-900">{one.name}</span> <span className="text-ink-500">({one.layer})</span> → {one.match.name}
                                  <span className="text-ink-500">
                                    {" "}
                                    · {one.against === "point" ? `on the map${one.where ? `, ${one.where}` : ""}` : one.against === "board" ? "a property on the board" : "in our properties, not on this board"}
                                    {one.match.by === "name" ? " · same name" : one.match.by === "similar" ? ` · similar name${one.match.metres !== null ? `, ${one.match.metres} m away` : ""}` : ` · ${one.match.metres} m away`}
                                  </span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-ink-500 mt-1">Ticked are left out. Ones in our properties but not on this board come in as points; adding such a point to the board uses the property we have.</p>
                    </>
                  )}
                </div>
              )}
              {importLayers.error && <p className="mt-1 text-[#c03654]">{friendlyError(importLayers.error)}</p>}
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={importLayers.isPending || check.isPending}
                  onClick={() => importLayers.mutate({ eventId, layers: incoming.layers, leaveOut: [...leaveOut] })}
                  className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 font-medium text-white disabled:opacity-60"
                >
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
