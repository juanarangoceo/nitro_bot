"use server";

// Server Actions del Panel de Plataforma. CADA UNA verifica super-admin con
// requirePlatformAdmin() antes de tocar nada (no confiamos en el proxy) y corre
// con service_role. Toda acción queda en audit_log (sin secretos en claro).

import { requirePlatformAdmin, logAudit } from "@/lib/admin/context";
import { provisionTenant, type ProvisionStep } from "@/lib/provisioning/provision";
import {
  subscribeWabaToApp,
  setBusinessProfile,
  uploadProfilePhoto,
  type BusinessProfile,
} from "@/lib/whatsapp/meta";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { uploadTenantLogo } from "@/lib/storage";
import { env } from "@/lib/env";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";

// ── Alta de cliente (el botón) ──────────────────────────────────────────────
export type ProvisionState = {
  ran: boolean;
  ok: boolean;
  steps: ProvisionStep[];
  error: string | null;
};

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function optStr(fd: FormData, k: string): string | undefined {
  const v = str(fd, k);
  return v || undefined;
}
function optNum(fd: FormData, k: string): number | undefined {
  const v = str(fd, k);
  return v ? Number(v) : undefined;
}

export async function provisionTenantAction(
  _prev: ProvisionState,
  fd: FormData
): Promise<ProvisionState> {
  const { admin, adminId } = await requirePlatformAdmin();

  // Validación mínima de obligatorios.
  const required = [
    "name",
    "slug",
    "shopify_domain",
    "wa_phone_number_id",
    "wa_token",
    "waba_id",
    "user_email",
    "user_password",
  ];
  const missing = required.filter((k) => !str(fd, k));
  if (missing.length) {
    return { ran: true, ok: false, steps: [], error: `Faltan campos: ${missing.join(", ")}` };
  }

  // Shopify: o token manual (token + API secret) o app para OAuth (client_id +
  // client_secret). Con el par, la conexión se completa luego desde el detalle.
  const hasManualToken = !!str(fd, "shopify_access_token") && !!str(fd, "shopify_api_secret");
  const hasOauthApp = !!str(fd, "shopify_client_id") && !!str(fd, "shopify_client_secret");
  if (!hasManualToken && !hasOauthApp) {
    return {
      ran: true,
      ok: false,
      steps: [],
      error:
        "Shopify: da el token manual (access token + API secret) o el par Client ID + Client Secret de la app (OAuth).",
    };
  }

  // Foto de perfil opcional.
  let profilePhoto: { bytes: Buffer; mimeType: string } | null = null;
  const photo = fd.get("profile_photo");
  if (photo instanceof File && photo.size > 0) {
    profilePhoto = {
      bytes: Buffer.from(await photo.arrayBuffer()),
      mimeType: photo.type || "image/jpeg",
    };
  }

  try {
    const result = await provisionTenant(
      {
        name: str(fd, "name"),
        slug: str(fd, "slug"),
        plan: optStr(fd, "plan") ?? null,
        monthlyFee: optNum(fd, "monthly_fee") ?? null,
        messageLimit: optNum(fd, "message_limit") ?? null,
        systemPrompt: optStr(fd, "system_prompt"),
        shopifyDomain: str(fd, "shopify_domain"),
        shopifyAccessToken: optStr(fd, "shopify_access_token"),
        shopifyApiSecret: optStr(fd, "shopify_api_secret"),
        shopifyClientId: optStr(fd, "shopify_client_id"),
        shopifyClientSecret: optStr(fd, "shopify_client_secret"),
        waPhoneNumberId: str(fd, "wa_phone_number_id"),
        waToken: str(fd, "wa_token"),
        wabaId: str(fd, "waba_id"),
        displayName: optStr(fd, "display_name") ?? null,
        about: optStr(fd, "about") ?? null,
        address: optStr(fd, "address") ?? null,
        email: optStr(fd, "email") ?? null,
        website: optStr(fd, "website") ?? null,
        profilePhoto,
        userEmail: str(fd, "user_email"),
        userPassword: str(fd, "user_password"),
      },
      adminId
    );
    revalidatePath("/admin");
    return { ran: true, ok: result.ok, steps: result.steps, error: null };
  } catch (e) {
    await logAudit(admin, {
      adminId,
      action: "provision_tenant_error",
      detail: { slug: str(fd, "slug"), message: (e as Error).message },
    });
    return { ran: true, ok: false, steps: [], error: (e as Error).message };
  }
}

// ── Activar / desactivar cliente ────────────────────────────────────────────
export async function setTenantActive(fd: FormData): Promise<void> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const active = String(fd.get("active") ?? "") === "true";
  if (!tenantId) return;

  await admin.from("tenants").update({ is_active: active }).eq("id", tenantId);
  await logAudit(admin, {
    adminId,
    action: active ? "reactivate" : "deactivate",
    tenantId,
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/clients/${tenantId}`);
}

// ── Editar datos del cliente (nombre / plan / fee / límite) ─────────────────
// El `name` es lo que ve el cliente en su dashboard (marca personalizada).
export async function updateTenantCommercial(fd: FormData): Promise<void> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!tenantId) return;

  const update: Record<string, unknown> = {};
  const name = String(fd.get("name") ?? "").trim();
  const plan = String(fd.get("plan") ?? "").trim();
  const fee = String(fd.get("monthly_fee") ?? "").trim();
  const limit = String(fd.get("message_limit") ?? "").trim();
  if (name) update.name = name;
  if (plan) update.plan = plan;
  if (fee) update.monthly_fee = Number(fee);
  if (limit) update.message_limit = Number(limit);
  // El correo de notificaciones viene prellenado en el formulario, así que se
  // actualiza siempre que el campo esté presente: vaciarlo desactiva los avisos.
  if (fd.has("notification_email")) {
    const email = String(fd.get("notification_email") ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    update.notification_email = email || null;
  }
  // El checkbox solo llega cuando está marcado; el hidden marca su presencia.
  if (fd.has("reminders_enabled_present")) {
    update.reminders_enabled = fd.get("reminders_enabled") === "on";
  }
  if (Object.keys(update).length === 0) return;

  await admin.from("tenants").update(update).eq("id", tenantId);
  await logAudit(admin, { adminId, action: "update_commercial", tenantId, detail: update });
  revalidatePath(`/admin/clients/${tenantId}`);
}

// ── Reiniciar el contador de mensajes (entrega en cero tras pruebas) ────────
export async function resetMessageCounter(fd: FormData): Promise<void> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!tenantId) return;

  await admin
    .from("tenants")
    .update({ current_month_messages: 0, counter_period_start: new Date().toISOString() })
    .eq("id", tenantId);
  await logAudit(admin, { adminId, action: "reset_counter", tenantId });
  revalidatePath(`/admin/clients/${tenantId}`);
}

// ── Editar el system_prompt (solo desde /admin) ─────────────────────────────
export type PromptState = { ok: boolean; error: string | null };

export async function updateSystemPromptAdmin(
  _prev: PromptState,
  fd: FormData
): Promise<PromptState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const prompt = String(fd.get("system_prompt") ?? "").trim();
  if (!tenantId) return { ok: false, error: "Falta el tenant." };
  if (prompt.length < 20) return { ok: false, error: "El prompt es muy corto (mín. 20)." };

  const { error } = await admin.from("tenants").update({ system_prompt: prompt }).eq("id", tenantId);
  if (error) return { ok: false, error: "No se pudo guardar." };

  await logAudit(admin, { adminId, action: "update_prompt", tenantId });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true, error: null };
}

// ── Rotar credenciales (re-ejecutar partes del alta) ────────────────────────
export type RotateState = { ok: boolean; error: string | null };

// Rotación PARCIAL: solo cambia los campos que vengan llenos; lo vacío se
// conserva (no se pisa). Shopify y WhatsApp son independientes entre sí.
export async function rotateShopifyCreds(
  _prev: RotateState,
  fd: FormData
): Promise<RotateState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const domain = String(fd.get("shopify_domain") ?? "").trim();
  const token = String(fd.get("shopify_access_token") ?? "").trim();
  const secret = String(fd.get("shopify_api_secret") ?? "").trim();
  if (!tenantId) return { ok: false, error: "Falta el tenant." };
  if (!domain && !token && !secret) {
    return { ok: false, error: "Llena al menos un campo a cambiar." };
  }
  try {
    if (domain) {
      await admin.from("tenants").update({ shopify_domain: domain }).eq("id", tenantId);
    }
    // Upsert merge-duplicates: solo toca las columnas presentes (preserva el
    // otro secreto de Shopify y el token de WhatsApp).
    const secrets: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() };
    if (token) secrets.shopify_access_token = encryptSecret(token);
    if (secret) secrets.shopify_webhook_secret = encryptSecret(secret);
    if (token || secret) {
      await admin.from("tenant_secrets").upsert(secrets, { onConflict: "tenant_id" });
    }
    await logAudit(admin, {
      adminId,
      action: "rotate_creds",
      tenantId,
      detail: { provider: "shopify", changed: { domain: !!domain, token: !!token, secret: !!secret } },
    });
    revalidatePath(`/admin/clients/${tenantId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Credenciales de la app de Shopify (OAuth, spec 08) ──────────────────────
// Guarda el Client ID (claro) y el Client Secret (cifrado) de la app del Dev
// Dashboard del cliente. Mismo patrón que la rotación: lo vacío se conserva y
// los valores nunca vuelven al navegador.
export async function saveShopifyAppCreds(
  _prev: RotateState,
  fd: FormData
): Promise<RotateState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const clientId = String(fd.get("shopify_client_id") ?? "").trim();
  const clientSecret = String(fd.get("shopify_client_secret") ?? "").trim();
  if (!tenantId) return { ok: false, error: "Falta el tenant." };
  if (!clientId && !clientSecret) {
    return { ok: false, error: "Llena al menos un campo a cambiar." };
  }
  try {
    const secrets: Record<string, unknown> = {
      tenant_id: tenantId,
      updated_at: new Date().toISOString(),
    };
    if (clientId) secrets.shopify_client_id = clientId;
    if (clientSecret) secrets.shopify_client_secret = encryptSecret(clientSecret);
    await admin.from("tenant_secrets").upsert(secrets, { onConflict: "tenant_id" });

    await logAudit(admin, {
      adminId,
      action: "save_shopify_app_creds",
      tenantId,
      detail: { changed: { client_id: !!clientId, client_secret: !!clientSecret } },
    });
    revalidatePath(`/admin/clients/${tenantId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Suscribe la WABA del cliente al webhook de la app y (opcional) configura el
// perfil de WhatsApp del número (about/dirección/email/web + foto). Lee las
// credenciales ya guardadas del tenant (descifradas server-side); los pasos que
// el formulario de "rotar" NO hace. Idempotente.
export type ConfigureWaState = { ok: boolean; error: string | null; detail: string | null };

export async function configureWaProfile(
  _prev: ConfigureWaState,
  fd: FormData
): Promise<ConfigureWaState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!tenantId) return { ok: false, error: "Falta el tenant.", detail: null };

  // Datos de enrutamiento del tenant (no secretos).
  const { data: t } = await admin
    .from("tenants")
    .select("wa_phone_number_id, wa_business_account_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!t?.wa_phone_number_id) {
    return { ok: false, error: "El tenant no tiene phone_number_id. Rota WhatsApp primero.", detail: null };
  }
  if (!t.wa_business_account_id) {
    return { ok: false, error: "Falta el WABA ID. Rótalo en 'Rotar WhatsApp'.", detail: null };
  }

  // Token cifrado del tenant → descifrar server-side.
  const { data: sec } = await admin
    .from("tenant_secrets")
    .select("wa_access_token")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!sec?.wa_access_token) {
    return { ok: false, error: "El tenant no tiene token de WhatsApp.", detail: null };
  }
  const token = decryptSecret(sec.wa_access_token);

  const notes: string[] = [];
  try {
    // 1) Suscribir la WABA al webhook de la app (idempotente).
    await subscribeWabaToApp(t.wa_business_account_id, token);
    notes.push("WABA suscrita");

    // 2) Perfil de negocio (opcional, según los campos del formulario).
    const profile: BusinessProfile = {};
    const about = String(fd.get("about") ?? "").trim();
    const address = String(fd.get("address") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const website = String(fd.get("website") ?? "").trim();
    if (about) profile.about = about;
    if (address) profile.address = address;
    if (email) profile.email = email;
    if (website) profile.websites = [website];

    const photo = fd.get("profile_photo");
    let photoUrlRef: string | null = null;
    if (photo instanceof File && photo.size > 0) {
      if (!env.META_APP_ID) {
        notes.push("foto omitida (falta META_APP_ID)");
      } else {
        const handle = await uploadProfilePhoto({
          appId: env.META_APP_ID,
          token,
          bytes: Buffer.from(await photo.arrayBuffer()),
          mimeType: photo.type || "image/jpeg",
        });
        profile.profile_picture_handle = handle;
        photoUrlRef = photo.name;
        notes.push("foto subida");
      }
    }

    if (Object.keys(profile).length > 0) {
      await setBusinessProfile(t.wa_phone_number_id, token, profile);
      notes.push("perfil configurado");
    }

    // Guardar referencias no sensibles en tenants.
    const ref: Record<string, unknown> = {};
    const displayName = String(fd.get("display_name") ?? "").trim();
    if (displayName) ref.wa_display_name = displayName;
    if (photoUrlRef) ref.wa_profile_photo_url = photoUrlRef;
    if (Object.keys(ref).length > 0) await admin.from("tenants").update(ref).eq("id", tenantId);

    await logAudit(admin, { adminId, action: "configure_wa", tenantId, detail: { notes } });
    revalidatePath(`/admin/clients/${tenantId}`);
    return { ok: true, error: null, detail: notes.join(" · ") };
  } catch (e) {
    return { ok: false, error: (e as Error).message, detail: notes.join(" · ") || null };
  }
}

// ── Restablecer contraseña de un usuario del tenant ─────────────────────────
// Genera una contraseña temporal legible, la fija vía Auth Admin API y la
// devuelve para mostrarla UNA SOLA VEZ. No se guarda en ningún lado; en
// audit_log queda la acción sin la contraseña.
export type ResetPasswordState = {
  ok: boolean;
  error: string | null;
  // Solo presente en la respuesta inmediata de la acción (se muestra una vez).
  tempPassword: string | null;
  email: string | null;
};

// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para dictarla sin errores.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateTempPassword(): string {
  const pick = () => PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}-${group()}`; // 14 caracteres
}

export async function resetUserPassword(
  _prev: ResetPasswordState,
  fd: FormData
): Promise<ResetPasswordState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const userId = String(fd.get("user_id") ?? "");
  if (!userId) return { ok: false, error: "Falta el usuario.", tempPassword: null, email: null };

  // Solo usuarios de dashboard (app_users); nunca cuentas de plataforma.
  const { data: appUser } = await admin
    .from("app_users")
    .select("id, tenant_id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!appUser) {
    return { ok: false, error: "Usuario no encontrado.", tempPassword: null, email: null };
  }

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) return { ok: false, error: error.message, tempPassword: null, email: null };

  await logAudit(admin, {
    adminId,
    action: "reset_password",
    tenantId: appUser.tenant_id,
    detail: { user_email: appUser.email },
  });
  return { ok: true, error: null, tempPassword, email: appUser.email };
}

// ── Crear usuario del dashboard ─────────────────────────────────────────────
// Alta explícita de un usuario para un tenant existente. A diferencia de
// seedDashboardUser (idempotente para el alta), aquí un email ya registrado es
// un ERROR: jamás resetea contraseñas ni re-apunta usuarios de otro tenant.
export type CreateUserState = {
  ok: boolean;
  error: string | null;
  tempPassword: string | null;
  email: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createDashboardUser(
  _prev: CreateUserState,
  fd: FormData
): Promise<CreateUserState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const fail = (error: string): CreateUserState => ({
    ok: false,
    error,
    tempPassword: null,
    email: null,
  });

  const tenantId = str(fd, "tenant_id");
  const email = str(fd, "email").toLowerCase();
  const role = str(fd, "role");
  if (!tenantId) return fail("Falta el cliente.");
  if (!EMAIL_RE.test(email)) return fail("El correo no es válido.");
  if (role !== "agent" && role !== "admin") return fail("Rol inválido.");

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return fail("Cliente no encontrado.");

  const { data: existing } = await admin
    .from("app_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) return fail("Ese correo ya tiene un usuario del dashboard.");

  const tempPassword = generateTempPassword();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !created?.user) {
    return fail(
      authError?.code === "email_exists"
        ? "Ese correo ya tiene una cuenta (fuera del dashboard). Usa otro correo."
        : `No se pudo crear la cuenta: ${authError?.message ?? "error desconocido"}`
    );
  }

  const { error: insertError } = await admin
    .from("app_users")
    .insert({ id: created.user.id, tenant_id: tenantId, email, role });
  if (insertError) {
    // Rollback: sin fila en app_users la cuenta de Auth quedaría huérfana.
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(`No se pudo registrar el usuario: ${insertError.message}`);
  }

  await logAudit(admin, {
    adminId,
    action: "create_user",
    tenantId,
    detail: { user_email: email, role },
  });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true, error: null, tempPassword, email };
}

// ── Eliminar usuario del dashboard ──────────────────────────────────────────
// Borra la cuenta de Auth (el cascade limpia app_users). Nunca deja al cliente
// sin usuarios: el último no se puede eliminar.
export type DeleteUserState = { ok: boolean; error: string | null };

export async function deleteDashboardUser(
  _prev: DeleteUserState,
  fd: FormData
): Promise<DeleteUserState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const userId = String(fd.get("user_id") ?? "");
  if (!userId) return { ok: false, error: "Falta el usuario." };

  // Solo usuarios de dashboard (app_users); nunca cuentas de plataforma.
  const { data: appUser } = await admin
    .from("app_users")
    .select("id, tenant_id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!appUser) return { ok: false, error: "Usuario no encontrado." };

  const { count } = await admin
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", appUser.tenant_id);
  if ((count ?? 0) <= 1) {
    return { ok: false, error: "Es el único usuario del cliente; crea otro antes de eliminarlo." };
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: `No se pudo eliminar: ${error.message}` };

  await logAudit(admin, {
    adminId,
    action: "delete_user",
    tenantId: appUser.tenant_id,
    detail: { user_email: appUser.email },
  });
  revalidatePath(`/admin/clients/${appUser.tenant_id}`);
  return { ok: true, error: null };
}

// ── Personalización del dashboard (logo + color de acento) ──────────────────
export type BrandingState = { ok: boolean; error: string | null };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export async function updateTenantBranding(
  _prev: BrandingState,
  fd: FormData
): Promise<BrandingState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = str(fd, "tenant_id");
  if (!tenantId) return { ok: false, error: "Falta el cliente." };

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return { ok: false, error: "Cliente no encontrado." };

  const update: Record<string, string | null> = {};

  const brandColor = str(fd, "brand_color");
  if (brandColor) {
    if (!HEX_RE.test(brandColor)) {
      return { ok: false, error: "El color debe ser hex #rrggbb (ej: #1d4ed8)." };
    }
    update.brand_color = brandColor.toLowerCase();
  }
  if (fd.get("clear_color") === "on") update.brand_color = null;

  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!logo.type.startsWith("image/")) {
      return { ok: false, error: "El logo debe ser una imagen." };
    }
    if (logo.size > MAX_LOGO_BYTES) {
      return { ok: false, error: "El logo no puede pesar más de 2 MB." };
    }
    update.logo_url = await uploadTenantLogo({
      tenantId,
      bytes: Buffer.from(await logo.arrayBuffer()),
      mimeType: logo.type,
    });
  }
  if (fd.get("clear_logo") === "on") update.logo_url = null;

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "No hay cambios que guardar." };
  }

  const { error } = await admin.from("tenants").update(update).eq("id", tenantId);
  if (error) return { ok: false, error: error.message };

  await logAudit(admin, {
    adminId,
    action: "update_branding",
    tenantId,
    detail: {
      logo: "logo_url" in update ? (update.logo_url ? "actualizado" : "quitado") : "sin cambio",
      brand_color: "brand_color" in update ? (update.brand_color ?? "quitado") : "sin cambio",
    },
  });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true, error: null };
}

// ── Borrar conversación (limpieza de pruebas internas) ──────────────────────
// Borra mensajes, tickets y eventos de la conversación y luego la conversación.
// No toca órdenes ya creadas (orders.conversation_id queda en null por FK).
// Solo /admin; el cliente nunca ve esta acción.
export type DeleteConversationState = { ok: boolean; error: string | null };

export async function deleteConversationAdmin(
  _prev: DeleteConversationState,
  fd: FormData
): Promise<DeleteConversationState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const conversationId = String(fd.get("conversation_id") ?? "");
  if (!conversationId) return { ok: false, error: "Falta la conversación." };

  const { data: conv } = await admin
    .from("conversations")
    .select("id, tenant_id, customer_phone, is_test")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversación no encontrada." };

  try {
    // Orden: hijos primero. event_log tiene FK on delete set null, pero la
    // spec pide borrar también las trazas de la conversación.
    await admin.from("event_log").delete().eq("conversation_id", conversationId);
    await admin.from("tickets").delete().eq("conversation_id", conversationId);
    await admin.from("messages").delete().eq("conversation_id", conversationId);
    const { error } = await admin.from("conversations").delete().eq("id", conversationId);
    if (error) return { ok: false, error: error.message };

    await logAudit(admin, {
      adminId,
      action: "delete_conversation",
      tenantId: conv.tenant_id,
      detail: { customer_phone: conv.customer_phone, is_test: conv.is_test },
    });
    revalidatePath("/admin/health");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function rotateWaCreds(_prev: RotateState, fd: FormData): Promise<RotateState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const phoneNumberId = String(fd.get("wa_phone_number_id") ?? "").trim();
  const token = String(fd.get("wa_token") ?? "").trim();
  const wabaId = String(fd.get("waba_id") ?? "").trim();
  if (!tenantId) return { ok: false, error: "Falta el tenant." };
  if (!phoneNumberId && !token && !wabaId) {
    return { ok: false, error: "Llena al menos un campo a cambiar." };
  }
  try {
    // Solo los campos provistos; un campo vacío NO borra el valor guardado.
    const tUpdate: Record<string, unknown> = {};
    if (phoneNumberId) tUpdate.wa_phone_number_id = phoneNumberId;
    if (wabaId) tUpdate.wa_business_account_id = wabaId;
    if (Object.keys(tUpdate).length) {
      await admin.from("tenants").update(tUpdate).eq("id", tenantId);
    }
    if (token) {
      await admin.from("tenant_secrets").upsert(
        { tenant_id: tenantId, wa_access_token: encryptSecret(token), updated_at: new Date().toISOString() },
        { onConflict: "tenant_id" }
      );
    }
    await logAudit(admin, {
      adminId,
      action: "rotate_creds",
      tenantId,
      detail: { provider: "whatsapp", changed: { phone: !!phoneNumberId, token: !!token, waba: !!wabaId } },
    });
    revalidatePath(`/admin/clients/${tenantId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
