"use server";

// Server Actions del Panel de Plataforma. CADA UNA verifica super-admin con
// requirePlatformAdmin() antes de tocar nada (no confiamos en el proxy) y corre
// con service_role. Toda acción queda en audit_log (sin secretos en claro).

import { requirePlatformAdmin, logAudit } from "@/lib/admin/context";
import { provisionTenant, type ProvisionStep } from "@/lib/provisioning/provision";
import { upsertTenant } from "@/lib/provisioning/tenant";
import { seedWaCreds } from "@/lib/provisioning/whatsapp";
import {
  subscribeWabaToApp,
  setBusinessProfile,
  uploadProfilePhoto,
  type BusinessProfile,
} from "@/lib/whatsapp/meta";
import { decryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { revalidatePath } from "next/cache";

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
    "shopify_access_token",
    "shopify_api_secret",
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
        shopifyAccessToken: str(fd, "shopify_access_token"),
        shopifyApiSecret: str(fd, "shopify_api_secret"),
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
  if (Object.keys(update).length === 0) return;

  await admin.from("tenants").update(update).eq("id", tenantId);
  await logAudit(admin, { adminId, action: "update_commercial", tenantId, detail: update });
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

export async function rotateShopifyCreds(
  _prev: RotateState,
  fd: FormData
): Promise<RotateState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const slug = String(fd.get("slug") ?? "");
  const name = String(fd.get("name") ?? "");
  const domain = String(fd.get("shopify_domain") ?? "").trim();
  const token = String(fd.get("shopify_access_token") ?? "").trim();
  const secret = String(fd.get("shopify_api_secret") ?? "").trim();
  if (!slug || !domain || !token || !secret) {
    return { ok: false, error: "Completa dominio, token y secret de Shopify." };
  }
  try {
    await upsertTenant({
      slug,
      name,
      shopifyDomain: domain,
      shopifyAccessToken: token,
      shopifyApiSecret: secret,
    });
    await logAudit(admin, { adminId, action: "rotate_creds", tenantId, detail: { provider: "shopify" } });
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

export async function rotateWaCreds(_prev: RotateState, fd: FormData): Promise<RotateState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const slug = String(fd.get("slug") ?? "");
  const phoneNumberId = String(fd.get("wa_phone_number_id") ?? "").trim();
  const token = String(fd.get("wa_token") ?? "").trim();
  const wabaId = String(fd.get("waba_id") ?? "").trim() || null;
  if (!slug || !phoneNumberId || !token) {
    return { ok: false, error: "Completa phone_number_id y token de WhatsApp." };
  }
  try {
    await seedWaCreds({ slug, phoneNumberId, waToken: token, businessAccountId: wabaId });
    await logAudit(admin, { adminId, action: "rotate_creds", tenantId, detail: { provider: "whatsapp" } });
    revalidatePath(`/admin/clients/${tenantId}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
