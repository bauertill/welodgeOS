"use client";

/** Prints the page — or saves it as a PDF, from the browser's print dialog. Not printed itself. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="bg-brand-400 hover:bg-brand-500 rounded-full px-5 py-2 text-[13px] font-medium text-white print:hidden"
    >
      {label}
    </button>
  );
}
