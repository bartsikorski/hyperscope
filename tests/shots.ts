// One content and view as input for both renderers: the CPU reference's Shot, and the GPU hook's
// HyperscopeShot (plain data from which the page rebuilds the same content). The band's strips
// (input/strips.ts) are worked out on both sides from the same view.

import { sceneOf, type Content } from "../src/content/scene.ts";
import type { ViewState } from "../src/input/camera.ts";
import { stripsOf } from "../src/input/strips.ts";
import { frameGrid } from "../src/render/grid.ts";
import type { Shot } from "../src/render/reference.ts";

export function shots(content: Content, view: ViewState, width: number, height: number): { cpu: Shot; gpu: HyperscopeShot } {
  const settings = content.state.grid;
  const g = settings?.on ? view.grids[settings.kind] : undefined;
  const strips = stripsOf(view, content.group, content.colouring, width / height);
  return {
    cpu: {
      width, height, camera: view.camera, picture: view.picture, scene: sceneOf(content, view), grid: frameGrid(settings, view.grids, view.picture, height),
      strips: strips.length > 1
        ? strips.map((st) => ({ from: st.from, to: st.to, du: st.du, fog: st.fog, camera: st.view.camera, scene: sceneOf(content, st.view), grid: frameGrid(settings, st.view.grids, view.picture, height) }))
        : undefined,
    },
    gpu: {
      width, height, camera: view.camera, picture: view.picture, content: content.state, cameraPerm: view.perm, cameraTile: view.tile, origin: view.origin, shift: view.shift,
      gridCamera: g && { s: g.s.toString(), e: g.e, theta: g.theta },
    },
  };
}
