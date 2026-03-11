import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("/react-router") || id.includes("/@remix-run/")) {
            return "router";
          }

          if (id.includes("/@tanstack/")) {
            return "query";
          }

          if (id.includes("/@radix-ui/") || id.includes("/radix-ui/")) {
            return "radix";
          }

          if (id.includes("@dnd-kit")) {
            return "dnd-kit";
          }

          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        ws: true,
      },
    },
  },
});
