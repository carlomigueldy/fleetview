import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({ plugins: [react(), tailwind()], server: { proxy: { "/ws": { target: "ws://localhost:4317", ws: true } } } });
