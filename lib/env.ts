// Acceso central a variables de entorno del servidor.
// Nunca importar esto desde componentes de cliente: contiene secretos.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return v;
}

// Lectura perezosa: solo falla si realmente se usa la variable faltante.
export const env = {
  // Supabase (server-side)
  get SUPABASE_URL() {
    return required("SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY() {
    return required("SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  // Clave de cifrado de credenciales por tenant
  get TENANT_SECRET_ENC_KEY() {
    return required("TENANT_SECRET_ENC_KEY");
  },
  // Gemini (clave global de la agencia)
  get GEMINI_API_KEY() {
    return required("GEMINI_API_KEY");
  },
  // Meta / WhatsApp (globales de la app de la agencia)
  get META_APP_SECRET() {
    return required("META_APP_SECRET");
  },
  get META_VERIFY_TOKEN() {
    return required("META_VERIFY_TOKEN");
  },
  // App ID de Meta (opcional): solo se usa para la subida resumable de la foto
  // de perfil de WhatsApp en el alta. Si falta, el alta omite la foto.
  get META_APP_ID(): string | null {
    return process.env.META_APP_ID ?? null;
  },
  // Base URL pública del despliegue (para registrar webhooks de Shopify desde
  // el panel de alta). Cae a WEBHOOK_BASE_URL para compatibilidad con los scripts.
  get APP_BASE_URL(): string | null {
    return process.env.APP_BASE_URL ?? process.env.WEBHOOK_BASE_URL ?? null;
  },
  // Resend (opcionales): sin ellas las notificaciones por correo son no-op.
  get RESEND_API_KEY(): string | null {
    return process.env.RESEND_API_KEY ?? null;
  },
  // Remitente verificado en Resend, p. ej. "Nitro Bot <avisos@tudominio.com>".
  get NOTIFY_FROM_EMAIL(): string | null {
    return process.env.NOTIFY_FROM_EMAIL ?? null;
  },
};
