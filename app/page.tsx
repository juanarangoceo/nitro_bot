import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/context";

// La raíz rutea por rol: super-admin → /admin; cliente → /dashboard.
// Sin sesión, el proxy ya habría redirigido a /login para rutas protegidas;
// aquí, por seguridad, mandamos a /login.
export default async function Home() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (await isPlatformAdmin(user.id)) redirect("/admin");
  redirect("/dashboard");
}
