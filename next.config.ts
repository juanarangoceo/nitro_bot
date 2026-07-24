import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El decoder WASM trae workers con imports dinámicos que el bundler no
  // resuelve: se carga como dependencia externa de Node en runtime.
  serverExternalPackages: ["ogg-opus-decoder"],
  // Los comprobantes de pago viajan por una Server Action. Se limita a 3 MB
  // en la validación; 4 MB deja margen para el multipart sin acercarse al
  // límite de request de Vercel.
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
