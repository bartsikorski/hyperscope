import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` writes dist/index.html as one self-contained file (scripts, styles, shaders
// and fonts inlined), so it opens by double-click without a server.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", assetsInlineLimit: 100_000_000 },
});
