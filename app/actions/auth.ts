"use server";

// Server Actions de autenticación del dashboard. Corren solo en el servidor:
// entorno seguro para manejar credenciales. La sesión queda en cookies httpOnly
// gestionadas por @supabase/ssr.

import { createServerSupabase } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/context";
import { redirect } from "next/navigation";

export type AuthState = { error: string | null };

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Ingresa correo y contraseña." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Credenciales inválidas." };

  // Ruteo por rol: los super-admin entran al panel de plataforma.
  if (data.user && (await isPlatformAdmin(data.user.id))) redirect("/admin");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
