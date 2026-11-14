// The presets gallery under the icon row (design notes, step 9: Presets): the built-in presets as
// small pictures drawn on the GPU when it opens, and your own presets, each saved with a picture of
// the view, kept in this browser, written to a JSON file and read back from one (or dropped on the
// window). The gallery reads everything from its host and changes nothing itself.

import type { UserPreset } from "../state/presets.ts";
import { button, el, section } from "./widgets.ts";

export interface GalleryHost {
  /** The built-in presets' names. */
  builtIn(): string[];
  /** Built-in preset i as `size` x `size` device pixels, RGBA, top row first; null when it cannot be drawn now. */
  drawBuiltIn(i: number, size: number): Uint8Array | null;
  /** Changes whenever the built-in pictures would look different (the accent, the grid). */
  builtInKey(): string;
  /** The built-in preset whose tiling is on the screen, or -1. */
  currentBuiltIn(): number;
  chooseBuiltIn(i: number): void;
  user(): UserPreset[];
  chooseUser(i: number): void;
  /** Keep the view on the screen as a preset with this name. */
  saveCurrent(name: string): void;
  deleteUser(i: number): void;
  /** The name a new preset gets when none is typed: what the title says. */
  defaultName(): string;
  exportAll(): void;
  importFile(file: File): void;
}

/** The pictures, CSS pixels (square). */
export const THUMB_CSS = 96;
/** A delete waits this long for its confirming second click. */
const ARMED_MS = 3000;

export class Gallery {
  readonly el: HTMLElement;
  private host: GalleryHost;
  private builtIn: { button: HTMLButtonElement; canvas: HTMLCanvasElement }[] = [];
  private mine: HTMLElement;
  private name: HTMLInputElement;
  private drawn = "";
  private gen = 0;

  constructor(host: GalleryHost) {
    this.host = host;
    this.el = el("div", "hs-gallery hs-glass");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Presets");

    const grid = el("div", "hs-presets");
    this.builtIn = host.builtIn().map((name, i) => {
      const canvas = el("canvas", "hs-preset-canvas");
      canvas.width = canvas.height = THUMB_CSS;
      const b = button(canvas, name, () => host.chooseBuiltIn(i), { className: "hs-preset", tip: false });
      b.append(el("span", "hs-preset-name", name));
      grid.append(b);
      return { button: b, canvas };
    });

    this.mine = el("div", "hs-presets");
    this.name = el("input", "hs-input");
    this.name.type = "text";
    this.name.spellcheck = false;
    this.name.autocomplete = "off";
    this.name.maxLength = 80;
    this.name.setAttribute("aria-label", "Name of the new preset");
    const save = () => {
      host.saveCurrent(this.name.value.trim() || host.defaultName());
      this.name.value = "";
      this.refresh();
    };
    this.name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
    const saveRow = el("div", "hs-save");
    saveRow.append(this.name, button("Save", "Save the view on the screen as a preset", save, { className: "hs-action", tip: false }));
    const file = el("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.hidden = true;
    file.addEventListener("change", () => {
      if (file.files?.[0]) host.importFile(file.files[0]);
      file.value = "";
    });
    const actions = el("div", "hs-actions");
    actions.append(
      button("Export", "Write your presets to a JSON file", () => host.exportAll(), { className: "hs-action", tip: false }),
      button("Import", "Read presets from a JSON file", () => file.click(), { className: "hs-action", tip: false }),
      file,
    );
    this.el.append(section("Presets", grid), section("Yours", this.mine, saveRow, actions));
  }

  /** Show the state: which preset is on the screen, your presets, and the pictures if they changed. */
  refresh(): void {
    const current = this.host.currentBuiltIn();
    this.builtIn.forEach((p, i) => p.button.setAttribute("aria-pressed", String(i === current)));
    this.name.placeholder = this.host.defaultName();
    this.showMine();
    this.draw();
  }

  private showMine(): void {
    const list = this.host.user();
    if (list.length === 0) {
      this.mine.replaceChildren(el("p", "hs-note", "None yet. Save the view on the screen to keep it here, with its tiling, look and place."));
      return;
    }
    this.mine.replaceChildren(
      ...list.map((p, i) => {
        const cell = el("div", "hs-preset-cell");
        const img = el("img", "hs-preset-canvas");
        img.alt = "";
        if (p.thumb) img.src = p.thumb;
        const b = button(img, p.name, () => this.host.chooseUser(i), { className: "hs-preset", tip: false });
        b.append(el("span", "hs-preset-name", p.name));
        const del = button("×", `Delete ${p.name}`, () => {
          if (del.dataset.armed !== undefined) {
            this.host.deleteUser(i);
            this.refresh();
            return;
          }
          del.dataset.armed = "";
          del.textContent = "Delete?";
          setTimeout(() => {
            delete del.dataset.armed;
            del.textContent = "×";
          }, ARMED_MS);
        }, { className: "hs-delete", tip: false });
        cell.append(b, del);
        return cell;
      }),
    );
  }

  /** Draw the built-in pictures, two per task so the page stays responsive; a newer request drops
   *  what an older one has left to do. */
  private draw(): void {
    const key = this.host.builtInKey();
    if (key === this.drawn) return;
    this.drawn = key;
    const gen = ++this.gen;
    const size = Math.round(THUMB_CSS * Math.min(2, window.devicePixelRatio || 1));
    let i = 0;
    const next = () => {
      if (gen !== this.gen || this.el.hidden) {
        if (gen === this.gen) this.drawn = "";
        return;
      }
      for (const end = Math.min(this.builtIn.length, i + 2); i < end; i++) {
        const px = this.host.drawBuiltIn(i, size);
        const canvas = this.builtIn[i].canvas;
        if (!px) continue;
        if (canvas.width !== size) canvas.width = canvas.height = size;
        canvas.getContext("2d")?.putImageData(new ImageData(Uint8ClampedArray.from(px), size, size), 0, 0);
      }
      if (i < this.builtIn.length) setTimeout(next, 0);
    };
    setTimeout(next, 0);
  }
}
