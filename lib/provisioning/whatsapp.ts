// Carga (idempotente) de credenciales de WhatsApp en un tenant existente.
// El access token se cifra en tenant_secrets; el phone_number_id / business
// account id (no secretos, usados para enrutar) van en tenants, junto con las
// referencias del perfil. Compartido por scripts/seed-wa.ts y el panel.

import { createAdminClient } from "../supabase/admin";
import { encryptSecret } from "../crypto";

export type SeedWaInput = {
  slug: string;
  phoneNumberId: string;
  waToken: string;
  businessAccountId?: string | null;
  displayName?: string | null;
  profilePhotoUrl?: string | null;
};

export async function seedWaCreds(
  input: SeedWaInput
): Promise<{ id: string; name: string }> {
  const supabase = createAdminClient();

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("slug", input.slug)
    .maybeSingle();
  if (tErr) throw new Error(`No se pudo leer el tenant: ${tErr.message}`);
  if (!tenant) throw new Error(`No existe tenant con slug "${input.slug}".`);

  const update: Record<string, unknown> = {
    wa_phone_number_id: input.phoneNumberId,
  };
  if (input.businessAccountId !== undefined)
    update.wa_business_account_id = input.businessAccountId;
  if (input.displayName !== undefined) update.wa_display_name = input.displayName;
  if (input.profilePhotoUrl !== undefined)
    update.wa_profile_photo_url = input.profilePhotoUrl;

  const { error: uErr } = await supabase
    .from("tenants")
    .update(update)
    .eq("id", tenant.id);
  if (uErr) throw new Error(`Update de tenant falló: ${uErr.message}`);

  const { error: sErr } = await supabase.from("tenant_secrets").upsert(
    {
      tenant_id: tenant.id,
      wa_access_token: encryptSecret(input.waToken),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );
  if (sErr) throw new Error(`Upsert de secretos falló: ${sErr.message}`);

  return tenant;
}
