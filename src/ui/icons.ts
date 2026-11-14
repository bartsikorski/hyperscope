// Icons as inline SVG, bundled so the app works offline: Font Awesome 6 Free solid icons (CC BY 4.0,
// https://fontawesome.com/license/free, see THIRD_PARTY_NOTICES.md) and the five view pictograms,
// drawn here (six now): an ideal triangle in the Poincaré disk (arcs) and in the Klein disk (chords), two
// half-plane geodesics, the local view's rings of equal distance around its centre, the plane inside
// H3 as a horizon over ground lines running toward it, and the band's two edges with a geodesic
// across.

import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import type { Model } from "../math/views.ts";

const NS = "http://www.w3.org/2000/svg";

/** A Font Awesome icon, one em high and as wide as its own proportions. */
export function faIcon(def: IconDefinition): SVGSVGElement {
  const [w, h, , , path] = def.icon;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "hs-icon");
  svg.style.width = `${(w / h).toFixed(4)}em`;
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", Array.isArray(path) ? path.join(" ") : path);
  p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}

// the ideal triangle with vertices at 90, 210 and 330 degrees on a circle of radius 6.5 about
// (8, 8): its sides are arcs of radius 6.5 tan 60 degrees (orthogonal to the rim) or chords
const RIM = '<circle cx="8" cy="8" r="6.5"/>';
const ARC = 11.258;
const VIEW_PICTOGRAMS: Record<Model, string> = {
  poincare: `${RIM}<path d="M8 1.5A${ARC} ${ARC} 0 0 1 2.371 11.25A${ARC} ${ARC} 0 0 1 13.629 11.25A${ARC} ${ARC} 0 0 1 8 1.5"/>`,
  klein: `${RIM}<path d="M8 1.5L2.371 11.25L13.629 11.25Z"/>`,
  halfplane: '<path d="M1 13H15M1.5 13A5 5 0 0 1 11.5 13M13.5 13V3"/>',
  local: `${RIM}<circle cx="8" cy="8" r="3.25"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/>`,
  // a horizon, and lines on the ground running from the near edge toward it
  h3: '<path d="M1 5H15M8 5.5V15M6 5.5L1.5 15M10 5.5L14.5 15M4 9.5H12"/>',
  // the bowl of the upper sheet seen from the side, its rim drawn as an ellipse
  hyperboloid: '<path d="M1.5 3.5C4 8 5.5 13 8 13S12 8 14.5 3.5"/><ellipse cx="8" cy="3.5" rx="6.5" ry="1.75"/>',
  // the two edges of the band and a geodesic from one to the other
  band: '<path d="M1 3H15M1 13H15M4.5 13C4.5 8 11.5 8 11.5 3"/>',
};

/** The pictogram of a view, one em square, drawn in the current colour. */
export function viewIcon(model: Model): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "hs-icon hs-pictogram");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.3");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = VIEW_PICTOGRAMS[model];
  return svg;
}
