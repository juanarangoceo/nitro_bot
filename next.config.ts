import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El decoder WASM trae workers con imports dinámicos que el bundler no
  // resuelve: se carga como dependencia externa de Node en runtime.
  serverExternalPackages: ["ogg-opus-decoder"],
};

export default nextConfig;
