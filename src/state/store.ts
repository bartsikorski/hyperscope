// The one state object everything reads and writes: the view, the content and the interface's own
// settings. saved.ts turns it into the versioned form of the session, links, presets and
// screenshots (design: State, presets and links).

import type { ViewState } from "../input/camera.ts";
import type { ContentState } from "../content/scene.ts";
import type { UiState } from "./saved.ts";

export interface AppState {
  v: 1;
  view: ViewState;
  content: ContentState;
  ui: UiState;
}

export class Store {
  private listeners = new Set<(s: AppState) => void>();
  state: AppState;

  constructor(initial: AppState) {
    this.state = initial;
  }

  set(patch: Partial<Omit<AppState, "v">>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
