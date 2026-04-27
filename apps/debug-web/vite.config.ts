import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@/domain": resolve(__dirname, "src/domain"),
      "@/data": resolve(__dirname, "src/data"),
      "@/infrastructure": resolve(__dirname, "src/infrastructure"),
      "@/presentation": resolve(__dirname, "src/presentation"),
      "@/shared": resolve(__dirname, "src/shared"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
