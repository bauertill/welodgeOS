"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useIsAuthRoute } from "~/app/_components/nav";
import { PresenceDot } from "~/app/_components/team-directory";
import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { CustomStatusDialog, CustomStatusText } from "~/app/_components/status-dialog";
import { formatUntil } from "~/lib/format";
import {
  endOfToday,
  heartbeatMs,
  idleAfterMs,
  lunchChoices,
  presenceLabels,
  presencePollMs,
  statusChoices,
  unreadPollMs,
} from "~/lib/team";
import { api } from "~/trpc/react";

export const teamItems = [
  { href: "/team/profile", label: "My profile" },
  { href: "/team", label: "Team" },
  { href: "/messages", label: "Messages" },
] as const;

/**
 * The team section (doc §2.7), tucked behind the company name at the foot of
 * the sidebar: hovering it — or clicking it, which is what works on a touch
 * screen and from the keyboard — opens a small menu above it.
 */
export function TeamMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unread = useUnreadTotal();

  // Choosing a page closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  if (useIsAuthRoute()) return null;

  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // A short grace period, so the pointer can travel from the name to the menu.
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {open && (
        <div className="absolute bottom-full left-0 w-full pb-2">
          <div className="rounded-xl bg-white p-2 shadow-xl">
            <p className="text-ink-500 px-3 pt-1 pb-2 text-[11px] font-medium tracking-wider uppercase">
              Team
            </p>
            {teamItems.map((item) => {
              const active =
                item.href === "/team" ? pathname === "/team" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors ${
                    active ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  {item.label}
                  {item.href === "/messages" && <UnreadBadge count={unread} />}
                </Link>
              );
            })}
            <div className="border-ink-200/60 mt-1 border-t pt-1">
              <SoundToggle />
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-[11px] tracking-wide text-white/40 uppercase transition-colors hover:text-white/80"
      >
        We Lodge AG
        <UnreadBadge count={unread} />
      </button>
    </div>
  );
}

const soundKey = "welodge.messageSound";

function readSoundOn() {
  try {
    return window.localStorage.getItem(soundKey) !== "off";
  } catch {
    return true;
  }
}

/**
 * A soft two-note chime whenever the unread count goes up (doc §2.7) — not on
 * first load, and not for a message in the conversation you have open, since
 * that one is read the moment it arrives. Drawn with the Web Audio API rather
 * than an audio file. Silent while the person is on Do not disturb. Browsers only allow sound after the person has clicked
 * or typed somewhere on the page, so until then it stays silent.
 */
export function MessageSound() {
  const unread = useUnreadTotal();
  const me = api.user.me.useQuery();
  const doNotDisturb = me.data?.status === "DO_NOT_DISTURB";
  const previous = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = unread;
    if (before === null || unread <= before || doNotDisturb || !readSoundOn()) return;
    const context = audio.current;
    if (context?.state === "running") chime(context);
  }, [unread, doNotDisturb]);

  return null;
}

function chime(context: AudioContext) {
  const start = context.currentTime;
  [880, 1318.5].forEach((frequency, index) => {
    const at = start + index * 0.12;
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, at);
    volume.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    tone.connect(volume).connect(context.destination);
    tone.start(at);
    tone.stop(at + 0.4);
  });
}

/** Sound on or off, remembered in this browser only. */
function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(readSoundOn()), []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !on;
        setOn(next);
        try {
          window.localStorage.setItem(soundKey, next ? "on" : "off");
        } catch {
          // Private browsing: the choice lasts until the page is reloaded.
        }
      }}
      className="text-ink-700 hover:bg-ink-50 flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors"
    >
      Message sound
      <span className={on ? "text-brand-700" : "text-ink-500"}>{on ? "On" : "Off"}</span>
    </button>
  );
}

/** For the header on a phone, where there is no sidebar to hover. */
export function TeamHeaderLink() {
  const unread = useUnreadTotal();
  if (useIsAuthRoute()) return null;
  return (
    <Link
      href="/team"
      className="flex items-center gap-2 text-[13px] text-white/80 md:hidden"
    >
      Team
      <UnreadBadge count={unread} />
    </Link>
  );
}

function useUnreadTotal() {
  const unread = api.chat.unreadTotal.useQuery(undefined, {
    refetchInterval: unreadPollMs,
    retry: false,
  });
  return unread.data ?? 0;
}

export function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="bg-brand-400 inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[11px] font-medium text-white"
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Keeps the signed-in person's dot honest (doc §2.7). While they are clicking,
 * typing or moving the mouse in this tab it tells the server so once a minute;
 * after five idle minutes it stops, and they drift to Away.
 */
export function PresenceHeartbeat() {
  const beat = api.user.heartbeat.useMutation();
  const lastActivity = useRef(Date.now());
  const lastBeat = useRef(0);

  useEffect(() => {
    const send = () => {
      lastBeat.current = Date.now();
      beat.mutate();
    };
    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity.current >= idleAfterMs;
      lastActivity.current = Date.now();
      // Coming back after a break turns the dot green straight away.
      if (wasIdle || Date.now() - lastBeat.current >= heartbeatMs) send();
    };
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "focus"] as const;
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    send();
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < idleAfterMs) send();
    }, heartbeatMs);
    return () => {
      events.forEach((name) => window.removeEventListener(name, onActivity));
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once per page
  }, []);

  return null;
}

/** "HH:MM" an hour from now, as a starting point for "back at". */
function inAnHour() {
  const at = new Date(Date.now() + 60 * 60_000);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * "● Active ▾" in the header: where a person sets their own status (doc §2.7).
 * At lunch asks how long before it is set; Add a status opens "Your status".
 */
export function StatusPicker() {
  const utils = api.useUtils();
  const me = api.user.me.useQuery(undefined, { refetchInterval: presencePollMs });
  const [open, setOpen] = useState(false);
  const [askingLunch, setAskingLunch] = useState(false);
  const [backAt, setBackAt] = useState(inAnHour);
  const [lunchProblem, setLunchProblem] = useState<string | null>(null);
  const [editingCustom, setEditingCustom] = useState(false);
  const setStatus = api.user.setStatus.useMutation({
    onSuccess: () => {
      void utils.user.invalidate();
      void utils.chat.invalidate();
      close();
    },
  });

  const close = () => {
    setOpen(false);
    setAskingLunch(false);
    setLunchProblem(null);
  };

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  if (useIsAuthRoute() || !me.data) return null;
  const mine = me.data;
  // Your own dot: if you are looking at it, you are active.
  const presence = mine.presence === "AWAY" ? "ACTIVE" : mine.presence;
  const until = mine.presence === mine.status ? mine.statusUntil : null;

  const lunchFor = (minutes: number) =>
    setStatus.mutate({ status: "AT_LUNCH", until: new Date(Date.now() + minutes * 60_000) });
  const lunchUntil = () => {
    const [hours, minutes] = backAt.split(":").map(Number);
    const at = new Date();
    at.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      setLunchProblem("Choose a time later today.");
      return;
    }
    setStatus.mutate({ status: "AT_LUNCH", until: at });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex max-w-[16rem] items-center gap-2 rounded-full border border-white/25 px-4 py-2 text-[13px] font-light text-white transition-colors hover:bg-white/10"
      >
        <PresenceDot presence={presence} className="shrink-0" />
        <span className="truncate">{presenceLabels[presence]}</span>
        {mine.customStatus && (
          <span aria-label={mine.customStatus.text} title={mine.customStatus.text}>
            {mine.customStatus.emoji}
          </span>
        )}
        <span aria-hidden="true" className="text-white/60">
          ▾
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[1010]" onClick={close} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 z-[1020] mt-2 w-80 rounded-xl bg-white p-2 shadow-xl"
          >
            {askingLunch ? (
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => setAskingLunch(false)}
                  className="text-ink-500 hover:text-brand-700 mb-2 text-[13px] font-light"
                >
                  ← Back
                </button>
                <p className="text-ink-900 text-[13px] font-medium">How long will you be at lunch?</p>
                <p className="text-ink-500 mb-3 text-xs font-light">
                  You go back to automatic when it runs out.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {lunchChoices.map((choice) => (
                    <Button
                      key={choice.minutes}
                      type="button"
                      variant="secondary"
                      className="justify-center"
                      disabled={setStatus.isPending}
                      onClick={() => lunchFor(choice.minutes)}
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <Field label="Or back at" className="flex-1">
                    <Input type="time" value={backAt} onChange={(e) => setBackAt(e.target.value)} />
                  </Field>
                  <Button type="button" disabled={setStatus.isPending} onClick={lunchUntil}>
                    Set
                  </Button>
                </div>
                <FormError message={lunchProblem ?? friendlyError(setStatus.error)} />
              </div>
            ) : (
              <>
                {statusChoices.map((choice) => {
                  const chosen =
                    choice.status === null
                      ? mine.presence === "ACTIVE" || mine.presence === "AWAY"
                      : mine.presence === choice.status;
                  return (
                    <button
                      key={choice.label}
                      type="button"
                      role="menuitemradio"
                      aria-checked={chosen}
                      disabled={setStatus.isPending}
                      onClick={() => {
                        if (choice.status === "AT_LUNCH") setAskingLunch(true);
                        else
                          setStatus.mutate({
                            status: choice.status,
                            until: choice.status === "DONE_FOR_THE_DAY" ? endOfToday() : null,
                          });
                      }}
                      className="hover:bg-ink-50 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                    >
                      <PresenceDot presence={choice.status ?? "ACTIVE"} className="mt-1 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="text-ink-900 block text-[13px] font-medium">
                          {choice.label}
                          {chosen && until && (
                            <span className="text-ink-500 font-light"> · {formatUntil(until)}</span>
                          )}
                        </span>
                        <span className="text-ink-500 block text-xs font-light">{choice.hint}</span>
                      </span>
                      {chosen && (
                        <span aria-hidden="true" className="text-brand-700 text-[13px]">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}

                <div className="border-ink-200/60 mt-1 border-t pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      setEditingCustom(true);
                    }}
                    className="hover:bg-ink-50 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                  >
                    <span aria-hidden="true" className="w-3 text-center text-[13px]">
                      {mine.customStatus ? mine.customStatus.emoji : "✎"}
                    </span>
                    <span className="min-w-0 flex-1">
                      {mine.customStatus ? (
                        <CustomStatusText
                          status={mine.customStatus}
                          showUntil
                          className="text-ink-900 max-w-full text-[13px]"
                        />
                      ) : (
                        <span className="text-ink-900 text-[13px] font-medium">Add a status</span>
                      )}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {editingCustom && (
        <CustomStatusDialog current={mine.customStatus} onClose={() => setEditingCustom(false)} />
      )}
    </div>
  );
}
