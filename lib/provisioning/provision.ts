// Orquesta el alta COMPLETA de un cliente (el "botón" del panel) de forma
// idempotente y reportando el estado paso a paso. Reúne las funciones de
// lib/provisioning/* y las integraciones de Meta. Cada paso captura su propio
// resultado; si un paso falla, los siguientes que dependan de él se omiten, y
// el alta se puede reintentar sin duplicar (todo es upsert).

import { createAdminClient } from "../supabase/admin";
import { env } from "../env";
import { upsertTenant } from "./tenant";
import { runBackfill } from "./catalog";
import { registerShopifyWebhooks } from "./webhooks";
import { seedWaCreds } from "./whatsapp";
import { seedDashboardUser } from "./user";
import { runVerify } from "./verify";
import {
  subscribeWabaToApp,
  setBusinessProfile,
  uploadProfilePhoto,
  type BusinessProfile,
} from "../whatsapp/meta";

export type ProvisionInput = {
  // Identidad / comercial
  name: string;
  slug: string;
  plan?: string | null;
  monthlyFee?: number | null;
  messageLimit?: number | null;
  systemPrompt?: string;
  // Shopify: token manual (compatibilidad) O par client_id/client_secret de la
  // app del Dev Dashboard (la conexión OAuth se hace luego desde el detalle).
  shopifyDomain: string;
  shopifyAccessToken?: string;
  shopifyApiSecret?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  // WhatsApp
  waPhoneNumberId: string;
  waToken: string;
  wabaId: string;
  // Perfil de WhatsApp
  displayName?: string | null;
  about?: string | null;
  address?: string | null;
  email?: string | null;
  website?: string | null;
  profilePhoto?: { bytes: Buffer; mimeType: string } | null;
  // Usuario del cliente
  userEmail: string;
  userPassword: string;
};

// pending: el paso no falló, quedó a la espera de una acción posterior (ámbar
// en el panel) — p. ej. backfill/webhooks cuando Shopify se conectará por OAuth.
export type ProvisionStep = { name: string; ok: boolean; detail: string; pending?: boolean };
export type ProvisionResult = {
  ok: boolean;
  tenantId: string | null;
  steps: ProvisionStep[];
};

export async function provisionTenant(
  input: ProvisionInput,
  adminId: string
): Promise<ProvisionResult> {
  const steps: ProvisionStep[] = [];
  let tenantId: string | null = null;
  const baseUrl = env.APP_BASE_URL;

  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, detail: (e as Error).message });
      return false;
    }
  };

  // ¿Hay token de Shopify ya, o queda pendiente la conexión OAuth?
  const hasShopifyToken = !!input.shopifyAccessToken;
  const PENDING_OAUTH = "Pendiente: conectar Shopify desde el detalle del cliente";
  const pendingStep = (name: string) =>
    steps.push({ name, ok: true, pending: true, detail: PENDING_OAUTH });

  // 1) Tenant + secretos de Shopify.
  const tenantOk = await step("Crear/actualizar tenant", async () => {
    const t = await upsertTenant({
      slug: input.slug,
      name: input.name,
      shopifyDomain: input.shopifyDomain,
      shopifyAccessToken: input.shopifyAccessToken,
      shopifyApiSecret: input.shopifyApiSecret,
      shopifyClientId: input.shopifyClientId,
      shopifyClientSecret: input.shopifyClientSecret,
      systemPrompt: input.systemPrompt,
      plan: input.plan,
      monthlyFee: input.monthlyFee,
      messageLimit: input.messageLimit,
    });
    tenantId = t.id;
    return `${t.name} (${t.id})`;
  });

  if (!tenantOk) {
    // Sin tenant no podemos seguir con nada que dependa de él.
    return { ok: false, tenantId, steps };
  }

  // 2) Backfill del catálogo con embeddings.
  if (hasShopifyToken) {
    await step("Backfill del catálogo", async () => {
      const n = await runBackfill(input.slug);
      if (n === 0) throw new Error("0 productos sincronizados (¿token o dominio?)");
      return `${n} producto(s) con embedding`;
    });
  } else {
    pendingStep("Backfill del catálogo");
  }

  // 3) Webhooks de Shopify.
  if (hasShopifyToken) {
    await step("Registrar webhooks de Shopify", async () => {
      if (!baseUrl) throw new Error("Falta APP_BASE_URL / WEBHOOK_BASE_URL");
      const r = await registerShopifyWebhooks(input.slug, baseUrl);
      return r.map((x) => `${x.topic}:${x.action}`).join(", ");
    });
  } else {
    pendingStep("Registrar webhooks de Shopify");
  }

  // 4) Credenciales de WhatsApp.
  await step("Guardar credenciales de WhatsApp", async () => {
    await seedWaCreds({
      slug: input.slug,
      phoneNumberId: input.waPhoneNumberId,
      waToken: input.waToken,
      businessAccountId: input.wabaId,
      displayName: input.displayName ?? null,
    });
    return `phone_number_id ${input.waPhoneNumberId}`;
  });

  // 5) Suscribir la WABA al webhook de la app (CRÍTICO).
  await step("Suscribir WABA al webhook", async () => {
    await subscribeWabaToApp(input.wabaId, input.waToken);
    return "suscrita";
  });

  // 6) Perfil de WhatsApp (foto + datos).
  await step("Configurar perfil de WhatsApp", async () => {
    const profile: BusinessProfile = {};
    if (input.about) profile.about = input.about;
    if (input.address) profile.address = input.address;
    if (input.email) profile.email = input.email;
    if (input.website) profile.websites = [input.website];

    let photoNote = "sin foto";
    if (input.profilePhoto) {
      const appId = env.META_APP_ID;
      if (!appId) {
        photoNote = "foto omitida (falta META_APP_ID)";
      } else {
        const handle = await uploadProfilePhoto({
          appId,
          token: input.waToken,
          bytes: input.profilePhoto.bytes,
          mimeType: input.profilePhoto.mimeType,
        });
        profile.profile_picture_handle = handle;
        photoNote = "foto subida";
      }
    }

    if (Object.keys(profile).length === 0) return "nada que configurar";
    await setBusinessProfile(input.waPhoneNumberId, input.waToken, profile);
    return photoNote;
  });

  // 7) Usuario del dashboard del cliente.
  await step("Crear usuario del dashboard", async () => {
    const u = await seedDashboardUser({
      slug: input.slug,
      email: input.userEmail,
      password: input.userPassword,
      role: "admin",
    });
    return u.reused ? `${input.userEmail} (reusado)` : input.userEmail;
  });

  // 8) Verificación (la de RAG/productos necesita el catálogo → pendiente si
  //    Shopify se conectará por OAuth).
  if (hasShopifyToken) {
    await step("Verificación del tenant", async () => {
      const v = await runVerify(input.slug);
      const passed = v.checks.filter((c) => c.ok).length;
      if (!v.ok) {
        const failed = v.checks.filter((c) => !c.ok).map((c) => c.name).join("; ");
        throw new Error(`${passed}/${v.checks.length} (falló: ${failed})`);
      }
      return `${passed}/${v.checks.length} en verde`;
    });
  } else {
    pendingStep("Verificación del tenant");
  }

  const ok = steps.every((s) => s.ok);

  // 9) Auditoría (sin secretos en claro).
  const supabase = createAdminClient();
  await supabase.from("audit_log").insert({
    admin_id: adminId,
    action: "provision_tenant",
    tenant_id: tenantId,
    detail: {
      slug: input.slug,
      name: input.name,
      ok,
      steps: steps.map((s) => ({ name: s.name, ok: s.ok })),
    },
  });

  return { ok, tenantId, steps };
}
