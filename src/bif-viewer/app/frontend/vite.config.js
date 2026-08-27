import { defineConfig } from "vite";

export default defineConfig({
  base: "/bif-viewer/", // <--- ÇOK ÖNEMLİ: Assets yollarını düzeltir
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://backend:8080",
        changeOrigin: true
      }
    }
  }
});
