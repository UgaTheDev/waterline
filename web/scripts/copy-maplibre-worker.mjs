// MapLibre loads its worker from a runtime URL that bundlers can't follow, so serve it from public/.
import { cpSync, mkdirSync } from "node:fs";
const src = "node_modules/maplibre-gl/dist";
mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(`${src}/${f}`, `public/maplibre/${f}`);
