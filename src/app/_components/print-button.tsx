"use client";

import { Button } from "~/app/_components/form";

/** Opens the browser's print window — where "Save as PDF" is too. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
