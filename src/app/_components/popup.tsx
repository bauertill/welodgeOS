"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** A popup over the page: closed with ×, Escape or a click beside it. */
export function Popup({
  title,
  subtitle,
  aside,
  onClose,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Escape closes, unless it is closing something inside first (a dropdown, a comment being written).
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
      close.current();
    };
    window.addEventListener("keydown", onEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onEscape);
      document.body.style.overflow = overflow;
    };
  }, []);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[1010] bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-3 top-4 bottom-4 z-[1020] mx-auto max-w-6xl overflow-y-auto rounded-2xl p-6 shadow-2xl sm:inset-x-6"
        style={{ backgroundColor: "#f3f3f3" }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-ink-900 text-xl font-semibold">{title}</h2>
            {subtitle && <p className="text-ink-500 mt-0.5 text-sm font-light">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {aside}
            <button type="button" onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-ink-900 text-2xl leading-none">
              ×
            </button>
          </div>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
