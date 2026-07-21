import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El decoder WASM trae workers con imports dinámicos que el bundler no
  // resuelve: se carga como dependencia externa de Node en runtime.
  serverExternalPackages: ["ogg-opus-decoder"],
  experimental: {
    serverActions: {
      // El default es 1 MB y tumba el envío de media del agente (los videos
      // llegan a 16 MB, el tope de WhatsApp). Margen extra para el overhead
      // del multipart.
      bodySizeLimit: "17mb",
    },
  },
};

export default nextConfig;
