// After `vite build`: give the single-file page its product name, so the file Bart opens
// by double-click is dist/hyperscope.html.
import { renameSync, existsSync } from "node:fs";

if (existsSync("dist/index.html")) renameSync("dist/index.html", "dist/hyperscope.html");
console.log("dist/hyperscope.html written");
