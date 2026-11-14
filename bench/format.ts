// One line of text per A/B row, for the page and for `npm run ab` (no DOM, so Node can load it).

import type { AbRow } from "./ab.ts";

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

export function formatRow(r: AbRow): string {
  const ms = (v: number[]) => (v.length ? median(v).toFixed(v.length && median(v) < 10 ? 3 : 1) : "-");
  const ref = r.aRef && r.bRef ? `  vs CPU reference: A ${(100 * r.aRef[0]).toFixed(2)}%, mean ${r.aRef[1].toFixed(2)}; B ${(100 * r.bRef[0]).toFixed(2)}%, mean ${r.bRef[1].toFixed(2)}` : "";
  const eq = `${(100 * r.within).toFixed(2)}% / ${r.worst}`;
  const ratio = Number.isNaN(r.ratio) ? "-" : `${r.ratio.toFixed(3)} (${r.ratioMin.toFixed(2)}–${r.ratioMax.toFixed(2)})`;
  return `${r.experiment.padEnd(22)} ${r.scene.padEnd(52)} ${r.unit.padEnd(13)} ${eq.padStart(15)} ${ms(r.a).padStart(9)} ${ms(r.b).padStart(9)}  ${ratio}${r.note ? `  ${r.note}` : ""}${ref}`;
}

export const HEADER = `${"experiment".padEnd(22)} ${"scene".padEnd(52)} ${"unit".padEnd(13)} ${"within 2 / worst".padStart(15)} ${"A ms".padStart(9)} ${"B ms".padStart(9)}  B / A (rounds)`;
