// The HUD's fonts, bundled so the app works offline (design: Interface): Inter 400 and 600 and
// JetBrains Mono 300 and 400, the Latin subsets from Fontsource (SIL Open Font License 1.1, see
// THIRD_PARTY_NOTICES.md). The build inlines the files; the FontFace API loads them.

import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import mono300 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-300-normal.woff2?url";
import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url";

const FACES: [family: string, url: string, weight: string][] = [
  ["Inter", inter400, "400"],
  ["Inter", inter600, "600"],
  ["JetBrains Mono", mono300, "300"],
  ["JetBrains Mono", mono400, "400"],
];

/** Add the faces to the document and load them; resolves once all have loaded or failed (the
 *  fallback fonts in hud.css stand in for any that fail). */
export function loadFonts(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return Promise.resolve();
  return Promise.all(
    FACES.map(([family, url, weight]) => {
      const face = new FontFace(family, `url(${url}) format("woff2")`, { weight, style: "normal", display: "swap" });
      document.fonts.add(face);
      return face.load().then(
        () => undefined,
        () => undefined,
      );
    }),
  ).then(() => undefined);
}
