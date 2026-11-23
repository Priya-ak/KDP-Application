import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = process.env.API_URL ?? "http://127.0.0.1:8790";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5180, proxy: { "/api": { target, changeOrigin: false } } },
  build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
});
