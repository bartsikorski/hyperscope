// The heads-up display (design: Interface): plain DOM over the canvas. Readouts in three corners,
// the chrome (the icon row and the settings card) that fades out when you rest, the help panel,
// toasts, Tab to hide it all and F for full screen. It writes the DOM only where a text changed and
// runs no animation loop of its own: the fade is a timer and CSS transitions, so the render loop
// stays idle while nothing moves.

import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { isField } from "../input/controls.ts";
import type { Box } from "./labels.ts";
import { exponentText } from "./readouts.ts";
import { faIcon } from "./icons.ts";
import { el } from "./widgets.ts";

export interface HudReadouts {
  /** The preset and the view, and the grid when it is on. */
  title: string;
  /** Samples in the picture, the most it takes, and whether it accumulates in float. */
  samples: number;
  maxSamples: number;
  float: boolean;
  /** The distance from the start point, as text (readouts.ts distanceText). */
  distance: string;
  /** log10 of the magnification. */
  magnification: number;
  /** Inside H3 the eye's height, on the hyperboloid the orbit's distance (readouts.ts eyeText,
   *  orbitText), with its key and a line under it, shown in place of the magnification; null in
   *  the other views. */
  eye: { key: string; height: string; detail: string } | null;
  /** Frames per second while frames are drawn, null while the render loop is idle. */
  fps: number | null;
  /** The canvas in device pixels. */
  width: number;
  height: number;
}

/** The chrome fades out after this long without pointer movement or a key. */
export const IDLE_MS = 2500;
const TOAST_MS = 2400;
/** The labels keep this far from the readouts' text. */
const KEEP_OUT = 6;

/** The controls listed in the help panel, by section. */
const HELP: [string, [string, string][]][] = [
  [
    "Mouse and touch",
    [
      ["Drag", "move the plane"],
      ["Right-drag", "rotate about the centre"],
      ["Wheel", "zoom at the cursor (Ctrl: finer, Shift: rotate)"],
      ["Double-click", "zoom in 4× there"],
      ["Middle click", "bring that point to the centre"],
      ["Two fingers", "pinch, twist and move"],
    ],
  ],
  [
    "Move",
    [
      ["W A S D, arrows", "move"],
      ["Q  E", "rotate"],
      ["+  −, PgUp PgDn", "zoom at the centre"],
      ["Z  X", "zoom at the cursor"],
      ["[  ]", "rotate by one symmetry step"],
      ["H", "home"],
      ["Backspace", "back through the views (Shift: forward)"],
    ],
  ],
  [
    "View and content",
    [
      ["1 – 7", "Poincaré disk, Klein disk, half-plane, local view, inside H³, hyperboloid, band"],
      ["C, Shift+C", "next, previous preset"],
      ["L, Shift+L or .  ,", "next, previous look"],
      ["P, Shift+P", "next, previous palette"],
      ["K, Shift+K", "next, previous colouring"],
      ["O, Shift+O", "next, previous construction: Lines, the Wythoff tilings, the snub"],
      ["M, Shift+M", "next, previous motif: none, Shoal, Moths, Rosette, Birds"],
      ["G", "unit grid on or off"],
      ["T, Shift+T", "grid type: Cartesian, polar, horocyclic"],
      ["U, Shift+U", "size of R: Earth's radius, 1 km, 1 m, bare units"],
    ],
  ],
  [
    "Interface",
    [
      ["Tab", "hide or show the interface"],
      ["F", "full screen"],
      ["F1 or ?", "this help"],
      ["Ctrl+C, Ctrl+V", "copy a link to this view, open a pasted one"],
      ["Ctrl+S, F12", "save a screenshot (its view is inside: drop it here to return)"],
      ["Drop a file", "a screenshot, saved state, presets or motif opens; any other picture fills the tile"],
      ["Esc", "close"],
    ],
  ],
  [
    "Inside H³ (5)",
    [
      ["W A S D, drag", "walk over the plane"],
      ["Q  E, right-drag", "turn; right-drag up and down looks up and down"],
      ["Wheel, +  −", "lower or raise the eye, 0.01 to 6 R"],
    ],
  ],
  [
    "Hyperboloid (6)",
    [
      ["Drag, W A S D", "move the plane over the surface"],
      ["Q  E, right-drag", "turn; right-drag up and down orbits higher or lower"],
      ["Wheel, +  −", "orbit nearer or farther, 1.5 to 40 R"],
    ],
  ],
  [
    "Controller",
    [
      ["Left stick", "move"],
      ["Right stick", "rotate, zoom (inside H³: turn, look up and down; hyperboloid: turn, orbit up and down)"],
      ["RT  LT", "zoom in, out (inside H³: down, up; hyperboloid: nearer, farther)"],
      ["LB  RB", "rotate by one symmetry step"],
      ["A", "next view"],
      ["B", "close, else back"],
      ["X  Y", "grid on or off, grid type"],
      ["D-pad", "preset (up, down), look (left, right)"],
      ["L3  R3", "palette, colouring"],
      ["Start, View", "home, hide the interface"],
    ],
  ],
];

const CREDITS =
  "Hyperscope, MIT licence. Palettes, zoom spring and HUD style after mandelscope (MIT). Fonts Inter and JetBrains Mono (SIL Open Font License), icons Font Awesome Free (CC BY 4.0).";

export class Hud {
  readonly root: HTMLElement;
  /** The top right corner: the icon row and, under it, the settings card or the gallery (setChrome). */
  readonly chrome: HTMLElement;
  /** Called when a readout's size changes, so the labels can keep clear of it again. */
  onLayout: () => void = () => {};
  /** Called when a panel (the settings card, the gallery) opens or closes. */
  onPanel: (panel: HTMLElement, open: boolean) => void = () => {};
  private toolbar: HTMLElement | null = null;
  private panels: HTMLElement[] = [];
  private sized: ResizeObserver;
  private tl: HTMLElement;
  private bl: HTMLElement;
  private magKey: HTMLElement;
  private mag: HTMLElement;
  private eye: HTMLElement;
  private eyeDetail: HTMLElement;
  private br: HTMLElement;
  private title: HTMLElement;
  private refine: HTMLElement;
  private refineText: HTMLElement;
  private bar: HTMLElement;
  private distance: HTMLElement;
  private exponent: HTMLElement;
  private fps: HTMLElement;
  private size: HTMLElement;
  private samples: HTMLElement;
  private help: HTMLElement;
  private toastEl: HTMLElement;
  private shown = new Map<HTMLElement, string>();
  private idleTimer = 0;
  private toastTimer = 0;
  private boxes: Box[] | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.tl = el("div", "hs-readout hs-tl");
    this.tl.append(el("div", "hs-brand", "HYPERSCOPE"), (this.title = el("div", "hs-title")));
    this.refine = el("div", "hs-refine");
    this.refine.append((this.refineText = el("div", "hs-refine-text")), (this.bar = el("div", "hs-bar")));
    this.bar.append(el("i"));
    this.tl.append(this.refine);

    this.bl = el("div", "hs-readout hs-bl");
    const dist = el("div", "hs-distance");
    dist.append(el("span", "hs-key", "Distance"), (this.distance = el("span", "hs-distance-value")));
    const mag = el("div", "hs-mag");
    mag.append("10", (this.exponent = el("sup")));
    this.magKey = el("div", "hs-key hs-mag-key", "Magnification");
    this.mag = mag;
    this.eye = el("div", "hs-mag hs-eye");
    this.eyeDetail = el("div", "hs-eye-detail");
    this.eye.hidden = this.eyeDetail.hidden = true;
    this.bl.append(dist, this.magKey, mag, this.eye, this.eyeDetail);

    this.br = el("div", "hs-readout hs-br");
    this.br.append((this.fps = el("span", "hs-fps")), " · ", (this.size = el("span", "hs-size")), " · ", (this.samples = el("span", "hs-samples")));

    this.help = this.buildHelp();
    this.toastEl = el("div", "hs-toast hs-glass");
    this.toastEl.setAttribute("role", "status");
    this.toastEl.setAttribute("aria-live", "polite");
    this.chrome = el("div", "hs-tr hs-chrome");
    root.append(this.tl, this.bl, this.br, this.chrome, this.help, this.toastEl);

    this.sized = new ResizeObserver(() => {
      this.boxes = null;
      this.onLayout();
    });
    for (const e of [this.tl, this.bl, this.br]) this.sized.observe(e);
  }

  /** Put the icon row and its panels (closed) into the top right corner. */
  setChrome(toolbar: HTMLElement, ...panels: HTMLElement[]): void {
    this.toolbar = toolbar;
    this.panels = panels;
    for (const p of panels) p.hidden = true;
    this.chrome.append(toolbar, ...panels);
    this.sized.observe(toolbar);
  }

  /** The panel that is open, if any. */
  get panel(): HTMLElement | null {
    return this.panels.find((p) => !p.hidden) ?? null;
  }

  /** Open or close a panel (by default, the other way round); opening one closes the other. */
  showPanel(panel: HTMLElement, open = panel.hidden): void {
    if (open === !panel.hidden) return;
    if (open) {
      const other = this.panel;
      if (other) this.showPanel(other, false);
      panel.hidden = false;
      this.setHidden(false);
    } else {
      if (panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      panel.hidden = true;
    }
    this.onPanel(panel, open);
    this.poke();
  }

  private buildHelp(): HTMLElement {
    const help = el("div", "hs-help hs-glass");
    help.hidden = true;
    help.setAttribute("role", "dialog");
    help.setAttribute("aria-label", "Controls");
    const head = el("div", "hs-help-head");
    const close = el("button", "hs-close");
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close");
    close.append(faIcon(faXmark));
    close.addEventListener("click", () => this.showHelp(false));
    head.append(el("h2", "", "Controls"), close);
    const cols = el("div", "hs-help-cols");
    for (const [section, rows] of HELP) {
      const part = el("section");
      const dl = el("dl");
      for (const [keys, what] of rows) dl.append(el("dt", "", keys), el("dd", "", what));
      part.append(el("h3", "", section), dl);
      cols.append(part);
    }
    help.append(head, cols, el("div", "hs-help-credits", CREDITS));
    return help;
  }

  /** Listen for activity and the HUD's own keys; returns a function that removes the listeners. */
  attach(): () => void {
    const poke = () => this.poke();
    const keyDown = (e: KeyboardEvent) => this.keyDown(e);
    const resize = () => (this.boxes = null);
    const events: [string, EventListener, AddEventListenerOptions?][] = [
      ["pointermove", poke, { passive: true }],
      ["pointerdown", poke, { passive: true }],
      ["wheel", poke, { passive: true }],
      ["keydown", keyDown as EventListener],
      ["resize", resize],
    ];
    for (const [t, f, o] of events) window.addEventListener(t, f, o);
    this.poke();
    return () => {
      for (const [t, f, o] of events) window.removeEventListener(t, f, o);
      clearTimeout(this.idleTimer);
    };
  }

  /** Activity: the chrome comes back and fades again IDLE_MS after the last of it. */
  poke(): void {
    this.root.classList.remove("hs-idle");
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.rest(), IDLE_MS);
  }

  private rest(): void {
    // not while the pointer is over the chrome, the help is open or a field has the keyboard
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && active !== document.body && this.root.contains(active) && active.matches(":focus-visible");
    if (!this.help.hidden || focused || this.root.querySelector(".hs-chrome:hover")) {
      this.idleTimer = window.setTimeout(() => this.rest(), IDLE_MS);
      return;
    }
    this.root.classList.add("hs-idle");
  }

  get idle(): boolean {
    return this.root.classList.contains("hs-idle");
  }

  get hidden(): boolean {
    return this.root.classList.contains("hs-hidden");
  }

  /** Hide or show everything but the toasts (Tab). */
  setHidden(on: boolean): void {
    if (on === this.hidden) return;
    if (on && this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.classList.toggle("hs-hidden", on);
    this.toast(on ? "Interface hidden: Tab shows it again" : "");
  }

  get helpOpen(): boolean {
    return !this.help.hidden;
  }

  showHelp(open = this.help.hidden): void {
    this.help.hidden = !open;
    if (open) this.setHidden(false);
    this.poke();
  }

  /** Close the help, else an open panel (Esc, a controller's B); false when nothing was open. */
  dismiss(): boolean {
    const panel = this.panel;
    if (this.helpOpen) this.showHelp(false);
    else if (panel) this.showPanel(panel, false);
    else return false;
    return true;
  }

  private keyDown(e: KeyboardEvent): void {
    this.poke();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      // one thing at a time: leave the field, then close the help, then the panel
      if (isField(e.target)) (e.target as HTMLElement).blur();
      else this.dismiss();
      return;
    }
    if (isField(e.target)) return;
    switch (e.key) {
      case "Tab": {
        // Tab moves between the controls while a panel is open or you work them with the keyboard
        const active = document.activeElement;
        if (this.panel || (active instanceof HTMLElement && active !== document.body && this.root.contains(active) && active.matches(":focus-visible"))) return;
        this.setHidden(!this.hidden);
        break;
      }
      case "f": case "F": this.toggleFullscreen(); break;
      case "F1": case "?": this.showHelp(); break;
      default: return;
    }
    e.preventDefault();
  }

  private toggleFullscreen(): void {
    const failed = () => this.toast("Full screen is not available here");
    try {
      const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: "hide" });
      done?.catch(failed);
    } catch {
      failed();
    }
  }

  /** A short note at the bottom of the screen, for ms; an empty text takes the current one away. */
  toast(text: string, ms = TOAST_MS): void {
    clearTimeout(this.toastTimer);
    if (!text) {
      delete this.toastEl.dataset.on;
      return;
    }
    this.toastEl.textContent = text;
    this.toastEl.dataset.on = "";
    this.toastTimer = window.setTimeout(() => delete this.toastEl.dataset.on, ms);
  }

  /** The accent colour of the controls, as #rrggbb. */
  setAccent(hex: string): void {
    this.root.style.setProperty("--accent", hex);
  }

  /** Show the readouts that are given. */
  update(r: Partial<HudReadouts>): void {
    if (r.title !== undefined && this.shown.get(this.title) !== r.title) {
      // one unbroken piece per part, so a long title wraps between its parts
      this.shown.set(this.title, r.title);
      this.title.replaceChildren();
      r.title.split(" · ").forEach((part, i) => {
        if (i > 0) this.title.append(" · ");
        this.title.append(el("span", "hs-part", part));
      });
    }
    if (r.distance !== undefined) this.set(this.distance, r.distance);
    if (r.magnification !== undefined) this.set(this.exponent, exponentText(r.magnification));
    if (r.eye !== undefined) {
      const inside = r.eye !== null;
      if (this.mag.hidden !== inside) {
        this.mag.hidden = inside;
        this.eye.hidden = this.eyeDetail.hidden = !inside;
      }
      this.set(this.magKey, r.eye ? r.eye.key : "Magnification");
      if (r.eye) {
        this.set(this.eye, r.eye.height);
        this.set(this.eyeDetail, r.eye.detail);
      }
    }
    if (r.fps !== undefined) this.set(this.fps, r.fps === null ? "Idle" : `${Math.round(r.fps)} FPS`);
    if (r.width !== undefined && r.height !== undefined) this.set(this.size, `${r.width}×${r.height}`);
    if (r.samples !== undefined && r.maxSamples !== undefined) {
      const { samples: n, maxSamples: max } = r;
      this.set(this.samples, `${n}/${max}`);
      this.samples.style.minWidth = `${2 * String(max).length + 1}ch`;
      const done = n >= max;
      const eightBit = r.float === false ? `8-bit accumulation, ${max} samples` : "";
      this.set(this.refineText, [done ? "" : `Refining ${n}/${max}`, eightBit].filter(Boolean).join(" · "));
      const fill = this.bar.firstChild as HTMLElement;
      const width = `${(100 * Math.min(n, max)) / max}%`;
      if (fill.style.width !== width) fill.style.width = width;
      this.flag(this.refine, "done", done);
      this.flag(this.refine, "quiet", done && !eightBit);
    }
  }

  private set(e: HTMLElement, text: string): void {
    if (this.shown.get(e) === text) return;
    this.shown.set(e, text);
    e.textContent = text;
  }

  private flag(e: HTMLElement, name: string, on: boolean): void {
    if (on) e.dataset[name] = "";
    else delete e.dataset[name];
  }

  /** Where the readouts and the icon row are, a little enlarged: the grid's labels keep out of
   *  these boxes (not out of the card, which would move them each time it opens). */
  keepOut(): Box[] {
    if (!this.boxes) {
      this.boxes = [this.tl, this.bl, this.br, ...(this.toolbar ? [this.toolbar] : [])].map((e) => {
        const r = e.getBoundingClientRect();
        return { x0: r.left - KEEP_OUT, x1: r.right + KEEP_OUT, y0: r.top - KEEP_OUT, y1: r.bottom + KEEP_OUT };
      });
    }
    return this.boxes;
  }
}
