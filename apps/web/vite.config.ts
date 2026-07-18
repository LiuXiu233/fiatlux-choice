import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeManifestIcons: false,
      manifest: {
        name: "FIAT LUX CHOICE",
        short_name: "FL CHOICE",
        description: "耀光电竞内部公司治理与运营平台",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#f5f6f7",
        theme_color: "#111827",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,jpg,woff2}"],
        navigateFallbackDenylist: [/^\/api\//, /^\/health\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
});
