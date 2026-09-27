"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Portalled onto <body> for the same stacking reason as the events panel. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1010] bg-black/20" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-1/2 left-1/2 z-[1020] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-ink-900 mb-4 text-[15px] font-medium">{title}</h2>
        {children}
      </div>
    </>,
    document.body,
  );
}
