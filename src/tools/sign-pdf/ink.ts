// Reads an ink colour row: a ready-made colour, or the colour picked on its rainbow swatch.
export function readInk(row: HTMLElement): string {
  if (row.querySelector("[data-custom-swatch]")?.classList.contains("is-picked")) return (row.querySelector("[data-custom]") as HTMLInputElement).value;
  return row.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? "#111111";
}

export function pickCustom(row: HTMLElement, on: boolean) {
  row.querySelector("[data-custom-swatch]")?.classList.toggle("is-picked", on);
  if (on) for (const radio of row.querySelectorAll<HTMLInputElement>('input[type="radio"]')) radio.checked = false;
}

// Back to the row's first colour.
export function resetInk(row: HTMLElement) {
  pickCustom(row, false);
  const first = row.querySelector<HTMLInputElement>('input[type="radio"]');
  if (first) first.checked = true;
}
