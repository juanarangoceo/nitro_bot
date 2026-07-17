// Cortes de fecha en hora de Colombia (America/Bogota, UTC-5 fijo: no hay
// horario de verano). Los filtros "desde/hasta" del dashboard reciben días
// del calendario del cliente; convertirlos con el offset fijo evita que una
// venta de las 11 pm aparezca en el día siguiente (los timestamps de la DB
// van en UTC).

const BOGOTA_OFFSET = "-05:00";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// "2026-07-15" → ISO UTC del inicio de ese día en Bogotá. null si es inválida.
export function bogotaDayStart(day: string): string | null {
  if (!DAY_RE.test(day)) return null;
  const d = new Date(`${day}T00:00:00${BOGOTA_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// "2026-07-15" → ISO UTC del inicio del día SIGUIENTE en Bogotá (para usar
// como cota exclusiva: created_at < fin). null si es inválida.
export function bogotaDayEnd(day: string): string | null {
  const start = bogotaDayStart(day);
  if (!start) return null;
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
