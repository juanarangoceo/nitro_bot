// Proxy (antes "middleware" en Next ≤15). Dos funciones:
//  1) Refresca la sesión de Supabase en cada request (rota el cookie del token).
//  2) Chequeo optimista de auth: si no hay usuario y la ruta es /dashboard,
//     redirige a /login. La autorización real (RLS + verificación de tenant) vive
//     en cada Server Component/Action; esto es solo el portón de entrada.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Portón optimista: rutas protegidas sin sesión → /login. La autorización real
  // (RLS del cliente, super-admin para /admin) vive en cada Server Component/Action.
  if (!user && (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Si ya hay sesión y va a /login, mándalo a la raíz, que rutea por rol
  // (super-admin → /admin, cliente → /dashboard). Evita el loop de un admin
  // (sin app_users) cayendo en /dashboard.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Corre en todo menos APIs (webhooks/worker), estáticos e imágenes.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
