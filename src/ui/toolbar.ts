// The icon row at the top right (design: Interface): home, back and forward through the views,
// the seven views, the presets gallery, the unit grid, a screenshot, the settings card and help. Each button names its key in its
// tooltip; the chosen view, the grid and the open card show in the accent colour.

import { faArrowLeft, faArrowRight, faBorderAll, faCamera, faCircleQuestion, faHouse, faImages, faSliders } from "@fortawesome/free-solid-svg-icons";
import type { Model } from "../math/views.ts";
import { MODELS, VIEW_KEYS } from "../math/views.ts";
import { faIcon, viewIcon } from "./icons.ts";
import { button, el, Segmented } from "./widgets.ts";

export interface ToolbarHost {
  home(): void;
  back(): void;
  forward(): void;
  setModel(model: Model): void;
  toggleGrid(): void;
  toggleCard(): void;
  toggleGallery(): void;
  screenshot(): void;
  help(): void;
}

export const VIEW_LABELS: Record<Model, string> = { poincare: "Poincaré disk", klein: "Klein disk", halfplane: "Half-plane", local: "Local view", h3: "Inside H³", hyperboloid: "Hyperboloid", band: "Band" };

export class Toolbar {
  readonly el: HTMLElement;
  private views: Segmented<Model>;
  private back: HTMLButtonElement;
  private forward: HTMLButtonElement;
  private grid: HTMLButtonElement;
  private settings: HTMLButtonElement;
  private presets: HTMLButtonElement;

  constructor(host: ToolbarHost) {
    this.el = el("div", "hs-toolbar hs-glass");
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Hyperscope");
    const sep = () => el("span", "hs-sep");
    this.back = button(faIcon(faArrowLeft), "Back", () => host.back(), { key: "Backspace" });
    this.forward = button(faIcon(faArrowRight), "Forward", () => host.forward(), { key: "Shift+Backspace" });
    this.views = new Segmented(
      MODELS.map((m) => ({ value: m, content: viewIcon(m), label: VIEW_LABELS[m], key: VIEW_KEYS[m] })),
      (m) => host.setModel(m),
      "hs-views",
    );
    this.presets = button(faIcon(faImages), "Presets", () => host.toggleGallery());
    this.presets.setAttribute("aria-haspopup", "dialog");
    this.grid = button(faIcon(faBorderAll), "Unit grid", () => host.toggleGrid(), { key: "G" });
    this.settings = button(faIcon(faSliders), "Settings", () => host.toggleCard());
    this.settings.setAttribute("aria-haspopup", "dialog");
    this.el.append(
      button(faIcon(faHouse), "Home", () => host.home(), { key: "H" }),
      this.back,
      this.forward,
      sep(),
      this.views.el,
      sep(),
      this.presets,
      this.grid,
      button(faIcon(faCamera), "Screenshot", () => host.screenshot(), { key: "Ctrl+S" }),
      this.settings,
      button(faIcon(faCircleQuestion), "Help", () => host.help(), { key: "F1" }),
    );
  }

  refresh(s: { model: Model; gridOn: boolean; canBack: boolean; canForward: boolean; cardOpen: boolean; galleryOpen: boolean }): void {
    this.views.set(s.model);
    if (this.back.disabled === s.canBack) this.back.disabled = !s.canBack;
    if (this.forward.disabled === s.canForward) this.forward.disabled = !s.canForward;
    this.grid.setAttribute("aria-pressed", String(s.gridOn));
    this.settings.setAttribute("aria-expanded", String(s.cardOpen));
    this.presets.setAttribute("aria-expanded", String(s.galleryOpen));
  }
}
