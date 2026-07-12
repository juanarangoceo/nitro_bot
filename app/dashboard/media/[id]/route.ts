// Sirve la media de un mensaje al navegador SIN exponer el bucket privado.
// Verifica con RLS (cliente authenticated) que el mensaje pertenece al tenant
// del usuario; luego, si la media vive en Storage, firma una URL temporal con
// service_role y redirige. Si trae una URL externa (p.ej. foto de Shopify que
// envió el bot), redirige a ella directamente.
//
// `?format=wav`: los audios de WhatsApp son OGG/Opus, que Safari no reproduce;
// con este flag se devuelven los bytes transcodificados a WAV en vez del
// redirect. Si la transcodificación falla, cae al comportamiento normal.

import { NextResponse } from "next/server";
import { getDashboardContext } from "@/lib/dashboard/context";
import { downloadWaMedia, signedMediaUrl } from "@/lib/storage";
import { oggOpusToWav } from "@/lib/audio/ogg-to-wav";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase } = await getDashboardContext();

  // RLS: solo devuelve la fila si es del tenant del usuario.
  const { data: msg } = await supabase
    .from("messages")
    .select("media_path, media_url, media_mime")
    .eq("id", id)
    .maybeSingle();

  if (!msg) return new NextResponse("No encontrado", { status: 404 });

  if (msg.media_path) {
    const wantsWav = new URL(req.url).searchParams.get("format") === "wav";
    const isOgg = (msg.media_mime ?? "").startsWith("audio/ogg");
    if (wantsWav && isOgg) {
      const ogg = await downloadWaMedia(msg.media_path);
      const wav = ogg ? await oggOpusToWav(ogg) : null;
      if (wav) {
        return new NextResponse(new Uint8Array(wav), {
          headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(wav.length),
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
      // Transcodificación fallida: seguir con el redirect al original.
    }
    const url = await signedMediaUrl(msg.media_path, 120);
    if (url) return NextResponse.redirect(url);
  }
  if (msg.media_url) return NextResponse.redirect(msg.media_url);

  return new NextResponse("Sin media", { status: 404 });
}
