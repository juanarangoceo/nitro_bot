"use server";

// Cambio de contraseña del propio usuario del dashboard.
// La contraseña actual se valida RE-AUTENTICANDO contra Supabase Auth
// (signInWithPassword) antes de updateUser: sin la actual no hay cambio.

import { createServerSupabase, getAuthUser } from "@/lib/supabase/server";

export type ChangePasswordState = { ok: boolean; error: string | null };

const MIN_LENGTH = 8;

export async function changeOwnPassword(
  _prev: ChangePasswordState,
  fd: FormData
): Promise<ChangePasswordState> {
  const user = await getAuthUser();
  if (!user?.email) return { ok: false, error: "Sesión no válida. Vuelve a iniciar sesión." };

  const current = String(fd.get("current_password") ?? "");
  const next = String(fd.get("new_password") ?? "");
  const confirm = String(fd.get("confirm_password") ?? "");

  if (!current) return { ok: false, error: "Escribe tu contraseña actual." };
  if (next.length < MIN_LENGTH) {
    return { ok: false, error: `La nueva contraseña debe tener al menos ${MIN_LENGTH} caracteres.` };
  }
  if (next !== confirm) return { ok: false, error: "Las contraseñas nuevas no coinciden." };
  if (next === current) {
    return { ok: false, error: "La nueva contraseña debe ser distinta de la actual." };
  }

  const supabase = await createServerSupabase();

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (authError) return { ok: false, error: "La contraseña actual no es correcta." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: "No se pudo actualizar la contraseña. Intenta de nuevo." };

  return { ok: true, error: null };
}
