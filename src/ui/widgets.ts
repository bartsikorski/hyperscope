// The HUD's controls as plain DOM: buttons with a tooltip that names their key, segmented choices,
// steppers, sliders, switches, lists and text fields. Each writes its element only when its value
// changed and leaves a field alone while it is being edited; hud.css styles them.

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

/** A button showing `content`, named `label` (with its key in the tooltip). */
export function button(content: Node | string, label: string, onClick: () => void, opts: { key?: string; className?: string; tip?: boolean } = {}): HTMLButtonElement {
  const b = el("button", opts.className ?? "hs-btn");
  b.type = "button";
  b.append(content);
  b.setAttribute("aria-label", label);
  if (opts.tip !== false) b.dataset.tip = opts.key ? `${label} · ${opts.key}` : label;
  b.addEventListener("click", onClick);
  return b;
}

const pressed = (b: HTMLElement, on: boolean) => {
  const v = on ? "true" : "false";
  if (b.getAttribute("aria-pressed") !== v) b.setAttribute("aria-pressed", v);
};

/** A row of buttons of which one is chosen. */
export class Segmented<T extends string> {
  readonly el: HTMLElement;
  private buttons = new Map<T, HTMLButtonElement>();

  constructor(options: { value: T; content: Node | string; label: string; key?: string }[], onChange: (v: T) => void, className = "hs-seg") {
    this.el = el("div", className);
    this.el.setAttribute("role", "group");
    for (const o of options) {
      const b = button(o.content, o.label, () => onChange(o.value), { key: o.key, className: "hs-seg-btn", tip: typeof o.content !== "string" });
      this.buttons.set(o.value, b);
      this.el.append(b);
    }
  }

  set(v: T | null): void {
    for (const [value, b] of this.buttons) pressed(b, value === v);
  }
}

/** An on/off switch with its label. */
export class Toggle {
  readonly el: HTMLButtonElement;

  constructor(label: string, onChange: (on: boolean) => void) {
    this.el = el("button", "hs-toggle");
    this.el.type = "button";
    this.el.setAttribute("role", "switch");
    this.el.append(el("span", "hs-toggle-track"), el("span", "hs-toggle-label", label));
    this.el.addEventListener("click", () => onChange(this.el.getAttribute("aria-checked") !== "true"));
  }

  set(on: boolean): void {
    const v = on ? "true" : "false";
    if (this.el.getAttribute("aria-checked") !== v) this.el.setAttribute("aria-checked", v);
  }
}

/** A whole number from min to max with buttons either side; `check` may refuse a value (its
 *  reason shows under the steppers and the stepper is marked). */
export class Stepper {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private value = 0;
  private min: number;
  private max: number;
  private onChange: (v: number) => void;

  constructor(label: string, min: number, max: number, onChange: (v: number) => void) {
    [this.min, this.max, this.onChange] = [min, max, onChange];
    this.el = el("div", "hs-stepper");
    this.input = el("input", "hs-input hs-stepper-value");
    this.input.type = "text";
    this.input.inputMode = "numeric";
    this.input.setAttribute("aria-label", label);
    this.input.addEventListener("change", () => this.commit(Number(this.input.value)));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.commit(this.value + (e.key === "ArrowUp" ? 1 : -1));
      }
    });
    const minus = button("−", `${label} smaller`, () => this.commit(this.value - 1), { className: "hs-step", tip: false });
    const plus = button("+", `${label} larger`, () => this.commit(this.value + 1), { className: "hs-step", tip: false });
    this.el.append(minus, this.input, plus);
  }

  private commit(v: number): void {
    if (!Number.isFinite(v)) return this.set(this.value, true);
    v = Math.min(this.max, Math.max(this.min, Math.round(v)));
    this.set(v, true);
    this.onChange(v);
  }

  set(v: number, force = false): void {
    this.value = v;
    if ((force || document.activeElement !== this.input) && this.input.value !== String(v)) this.input.value = String(v);
  }

  mark(bad: boolean): void {
    this.el.classList.toggle("hs-bad", bad);
  }
}

/** A slider from min to max (on a log scale when `log`), its value written beside it. */
export class Slider {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private out: HTMLElement;
  private opts: { min: number; max: number; log?: boolean; format: (v: number) => string; onInput: (v: number) => void };
  private static STEPS = 1000;

  constructor(label: string, opts: { min: number; max: number; log?: boolean; format: (v: number) => string; onInput: (v: number) => void }) {
    this.opts = opts;
    this.el = el("div", "hs-slider");
    this.input = el("input", "hs-range");
    this.input.type = "range";
    this.input.min = "0";
    this.input.max = String(Slider.STEPS);
    this.input.setAttribute("aria-label", label);
    this.out = el("output", "hs-slider-value");
    this.input.addEventListener("input", () => {
      const v = this.valueAt(Number(this.input.value) / Slider.STEPS);
      this.out.textContent = this.opts.format(v);
      this.opts.onInput(v);
    });
    this.el.append(this.input, this.out);
  }

  private valueAt(t: number): number {
    const { min, max, log } = this.opts;
    return log ? min * (max / min) ** t : min + (max - min) * t;
  }

  private positionOf(v: number): number {
    const { min, max, log } = this.opts;
    const t = log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    return Math.round(Math.min(1, Math.max(0, t)) * Slider.STEPS);
  }

  set(v: number): void {
    const text = this.opts.format(v);
    if (this.out.textContent !== text) this.out.textContent = text;
    if (document.activeElement === this.input) return;
    const pos = String(this.positionOf(v));
    if (this.input.value !== pos) this.input.value = pos;
  }

  /** New limits, for a value whose range depends on another setting (the line width's unit). */
  range(min: number, max: number, format: (v: number) => string): void {
    this.opts = { ...this.opts, min, max, format };
  }
}

/** A drop-down list. */
export class Select<T extends string> {
  readonly el: HTMLSelectElement;

  constructor(label: string, onChange: (v: T) => void) {
    this.el = el("select", "hs-input hs-select");
    this.el.setAttribute("aria-label", label);
    this.el.addEventListener("change", () => onChange(this.el.value as T));
  }

  /** The choices; consecutive ones with the same `group` go under one heading (an optgroup). */
  options(list: { value: T; label: string; group?: string }[]): void {
    const key = list.map((o) => `${o.value}\u0000${o.label}\u0000${o.group ?? ""}`).join("\u0001");
    if (this.el.dataset.key === key) return;
    this.el.dataset.key = key;
    const children: HTMLElement[] = [];
    let heading: HTMLOptGroupElement | null = null;
    for (const o of list) {
      const option = Object.assign(el("option", "", o.label), { value: o.value });
      if (o.group === undefined) {
        heading = null;
        children.push(option);
        continue;
      }
      if (!heading || heading.label !== o.group) children.push((heading = Object.assign(el("optgroup", ""), { label: o.group })));
      heading.append(option);
    }
    this.el.replaceChildren(...children);
  }

  set(v: T): void {
    if (this.el.value !== v) this.el.value = v;
  }
}

/** A text field that commits on Enter or when it loses focus; `commit` returns null when it took
 *  the text, or why not (the field is marked and keeps the text to correct). Esc puts back the
 *  value it showed. */
export class Field {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private shown = "";
  /** The text last offered to `commit`, so Enter and the change that follows act once. */
  private tried: string | null = null;

  private commit: (text: string) => string | null;

  constructor(label: string, commit: (text: string) => string | null, opts: { prefix?: string; unit?: string } = {}) {
    this.commit = commit;
    this.el = el("label", "hs-field");
    this.input = el("input", "hs-input");
    this.input.type = "text";
    this.input.inputMode = "decimal";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", label);
    if (opts.prefix) this.el.append(el("span", "hs-field-prefix", opts.prefix));
    this.el.append(this.input);
    if (opts.unit) this.el.append(el("span", "hs-field-unit", opts.unit));
    this.input.addEventListener("change", () => this.offer());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.offer();
      else if (e.key === "Escape") this.reset();
    });
    // once you leave the field it shows the value as it now is
    this.input.addEventListener("blur", () => {
      if (!this.el.classList.contains("hs-bad") && this.input.value !== this.shown) this.input.value = this.shown;
    });
  }

  private offer(): void {
    const text = this.input.value;
    if (text === this.shown || text === this.tried) return;
    this.tried = text;
    const why = this.commit(text);
    this.el.classList.toggle("hs-bad", why !== null);
    this.input.title = why ?? "";
  }

  set(text: string): void {
    this.shown = text;
    this.tried = null;
    if (document.activeElement === this.input || this.el.classList.contains("hs-bad")) return;
    if (this.input.value !== text) this.input.value = text;
  }

  /** Show the current value again, dropping a refused text. */
  reset(): void {
    this.el.classList.remove("hs-bad");
    this.input.title = "";
    this.tried = null;
    this.input.value = this.shown;
  }
}

/** A labelled row of the settings card. */
export function row(label: string, ...controls: (Node | string)[]): HTMLElement {
  const r = el("div", "hs-row");
  r.append(el("span", "hs-row-label", label), ...controls);
  return r;
}

export function section(title: string, ...rows: Node[]): HTMLElement {
  const s = el("section", "hs-section");
  s.append(el("h3", "hs-section-title", title), ...rows);
  return s;
}
