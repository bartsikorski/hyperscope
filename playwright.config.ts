import { defineConfig } from "@playwright/test";

// GPU tests run the real app in Chromium. Headless runs use the software WebGL2 renderer
// (SwiftShader), so they work on machines without a GPU; `--headed` uses your graphics card.
export default defineConfig({
  testDir: "tests/gpu",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 640, height: 480 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
