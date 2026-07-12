// Transcodifica OGG/Opus (notas de voz de WhatsApp / TTS) a WAV PCM 16-bit
// para navegadores sin soporte de OGG/Opus en <audio> (Safari en Mac/iPhone).
// Decodificación 100% WASM (`ogg-opus-decoder`), sin binarios nativos — corre
// en Node/Vercel. Solo para audios cortos: WAV pesa ~96 KB/s mono a 48 kHz.

import { OggOpusDecoder } from "ogg-opus-decoder";

// Mezcla los canales a mono y serializa un WAV PCM 16-bit little-endian.
function pcmToWav(channelData: Float32Array[], samples: number, sampleRate: number): Buffer {
  const dataSize = samples * 2; // mono, 16-bit
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // tamaño del chunk fmt
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits por muestra
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  const channels = channelData.length;
  for (let i = 0; i < samples; i++) {
    let sample = 0;
    for (let c = 0; c < channels; c++) sample += channelData[c][i] ?? 0;
    sample /= channels || 1;
    const clamped = Math.max(-1, Math.min(1, sample));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

// Devuelve el WAV o null si el contenido no es OGG/Opus decodificable.
// El llamador decide el fallback (p. ej. redirigir al original).
export async function oggOpusToWav(ogg: Uint8Array | Buffer): Promise<Buffer | null> {
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const { channelData, samplesDecoded, sampleRate } = await decoder.decodeFile(
      new Uint8Array(ogg)
    );
    if (!samplesDecoded || channelData.length === 0) return null;
    return pcmToWav(channelData, samplesDecoded, sampleRate);
  } catch {
    return null;
  } finally {
    decoder.free();
  }
}
