import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// Main process (electron/main), preload (electron/preload) and the page (index.html + src/), which serves all three windows:
// the tray panel (#panel), the viewer window (#viewer) and the About window (#about).
export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, "electron/main/index.ts") } } },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, "electron/preload/index.ts") } } },
  },
  renderer: {
    root: ".",
    // Why: debug runs read VITE_REMOTE_* to open a sheet at launch.
    envPrefix: ["VITE_"],
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, "index.html") } } },
  },
});
