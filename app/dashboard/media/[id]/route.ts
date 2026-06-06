// Sirve la media de un mensaje al navegador SIN exponer el bucket privado.
// Verifica con RLS (cliente authenticated) que el mensaje pertenece al tenant
// del usuario; luego, si la media vive en Storage, firma una URL temporal con
// service_role y redirige. Si trae una URL externa (p.ej. foto de Shopify que
// envió el bot), redirige a ella directamente.

import { NextResponse } from "next/server";
import { getDashboardContext } from "@/lib/dashboard/context";
import { signedMediaUrl } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase } = await getDashboardContext();

  // RLS: solo devuelve la fila si es del tenant del usuario.
  const { data: msg } = await supabase
    .from("messages")
    .select("media_path, media_url")
    .eq("id", id)
    .maybeSingle();

  if (!msg) return new NextResponse("No encontrado", { status: 404 });

  if (msg.media_path) {
    const url = await signedMediaUrl(msg.media_path, 120);
    if (url) return NextResponse.redirect(url);
  }
  if (msg.media_url) return NextResponse.redirect(msg.media_url);

  return new NextResponse("Sin media", { status: 404 });
}
