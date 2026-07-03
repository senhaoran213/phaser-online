import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true
      }
    }
  }
});
