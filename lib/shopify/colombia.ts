// Geografía de Colombia para órdenes Shopify: la API 2026-04 espera
// provinceCode (ISO 3166-2, sin el prefijo CO-) en MailingAddressInput.
// El departamento se deduce de la ciudad para las principales; si no está en
// el mapa, la IA se lo pregunta al cliente y llega como texto libre.

export type Department = { name: string; code: string };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Los 33 departamentos (nombre canónico → código ISO 3166-2:CO).
const DEPARTMENTS: Department[] = [
  { name: "Amazonas", code: "AMA" },
  { name: "Antioquia", code: "ANT" },
  { name: "Arauca", code: "ARA" },
  { name: "Atlántico", code: "ATL" },
  { name: "Bogotá D.C.", code: "DC" },
  { name: "Bolívar", code: "BOL" },
  { name: "Boyacá", code: "BOY" },
  { name: "Caldas", code: "CAL" },
  { name: "Caquetá", code: "CAQ" },
  { name: "Casanare", code: "CAS" },
  { name: "Cauca", code: "CAU" },
  { name: "Cesar", code: "CES" },
  { name: "Chocó", code: "CHO" },
  { name: "Córdoba", code: "COR" },
  { name: "Cundinamarca", code: "CUN" },
  { name: "Guainía", code: "GUA" },
  { name: "Guaviare", code: "GUV" },
  { name: "Huila", code: "HUI" },
  { name: "La Guajira", code: "LAG" },
  { name: "Magdalena", code: "MAG" },
  { name: "Meta", code: "MET" },
  { name: "Nariño", code: "NAR" },
  { name: "Norte de Santander", code: "NSA" },
  { name: "Putumayo", code: "PUT" },
  { name: "Quindío", code: "QUI" },
  { name: "Risaralda", code: "RIS" },
  { name: "San Andrés y Providencia", code: "SAP" },
  { name: "Santander", code: "SAN" },
  { name: "Sucre", code: "SUC" },
  { name: "Tolima", code: "TOL" },
  { name: "Valle del Cauca", code: "VAC" },
  { name: "Vaupés", code: "VAU" },
  { name: "Vichada", code: "VID" },
];

const DEPARTMENT_BY_NORMALIZED = new Map<string, Department>(
  DEPARTMENTS.map((d) => [normalize(d.name), d])
);
// Alias frecuentes en lenguaje natural.
for (const [alias, canonical] of [
  ["bogota", "Bogotá D.C."],
  ["bogota dc", "Bogotá D.C."],
  ["bogota distrito capital", "Bogotá D.C."],
  ["valle", "Valle del Cauca"],
  ["san andres", "San Andrés y Providencia"],
  ["guajira", "La Guajira"],
] as const) {
  const dep = DEPARTMENTS.find((d) => d.name === canonical)!;
  DEPARTMENT_BY_NORMALIZED.set(alias, dep);
}

// Ciudades principales → departamento canónico (cubren la gran mayoría de
// pedidos; el resto lo pregunta la IA).
const CITY_TO_DEPARTMENT: Record<string, string> = {
  "bogota": "Bogotá D.C.",
  // Cundinamarca
  "soacha": "Cundinamarca",
  "chia": "Cundinamarca",
  "zipaquira": "Cundinamarca",
  "fusagasuga": "Cundinamarca",
  "facatativa": "Cundinamarca",
  "girardot": "Cundinamarca",
  "mosquera": "Cundinamarca",
  "madrid": "Cundinamarca",
  "cajica": "Cundinamarca",
  // Antioquia
  "medellin": "Antioquia",
  "envigado": "Antioquia",
  "itagui": "Antioquia",
  "bello": "Antioquia",
  "sabaneta": "Antioquia",
  "rionegro": "Antioquia",
  "la estrella": "Antioquia",
  "apartado": "Antioquia",
  "caucasia": "Antioquia",
  "turbo": "Antioquia",
  // Valle del Cauca
  "cali": "Valle del Cauca",
  "palmira": "Valle del Cauca",
  "buenaventura": "Valle del Cauca",
  "tulua": "Valle del Cauca",
  "jamundi": "Valle del Cauca",
  "cartago": "Valle del Cauca",
  "buga": "Valle del Cauca",
  "yumbo": "Valle del Cauca",
  // Atlántico
  "barranquilla": "Atlántico",
  "soledad": "Atlántico",
  "malambo": "Atlántico",
  "sabanalarga": "Atlántico",
  // Bolívar
  "cartagena": "Bolívar",
  "magangue": "Bolívar",
  // Santander
  "bucaramanga": "Santander",
  "floridablanca": "Santander",
  "giron": "Santander",
  "piedecuesta": "Santander",
  "barrancabermeja": "Santander",
  // Norte de Santander
  "cucuta": "Norte de Santander",
  "ocana": "Norte de Santander",
  // Eje cafetero
  "pereira": "Risaralda",
  "dosquebradas": "Risaralda",
  "manizales": "Caldas",
  "armenia": "Quindío",
  // Otros
  "ibague": "Tolima",
  "espinal": "Tolima",
  "neiva": "Huila",
  "pitalito": "Huila",
  "villavicencio": "Meta",
  "pasto": "Nariño",
  "ipiales": "Nariño",
  "monteria": "Córdoba",
  "lorica": "Córdoba",
  "valledupar": "Cesar",
  "aguachica": "Cesar",
  "santa marta": "Magdalena",
  "cienaga": "Magdalena",
  "sincelejo": "Sucre",
  "popayan": "Cauca",
  "tunja": "Boyacá",
  "duitama": "Boyacá",
  "sogamoso": "Boyacá",
  "riohacha": "La Guajira",
  "maicao": "La Guajira",
  "quibdo": "Chocó",
  "florencia": "Caquetá",
  "yopal": "Casanare",
  "arauca": "Arauca",
  "mocoa": "Putumayo",
  "leticia": "Amazonas",
  "san andres": "San Andrés y Providencia",
};

// Resuelve el departamento: prioriza el que dijo el cliente (texto libre),
// luego el mapa de ciudades. Null = hay que preguntar.
export function resolveDepartment(ciudad: string, provisto?: string | null): Department | null {
  if (provisto?.trim()) {
    const dep = DEPARTMENT_BY_NORMALIZED.get(normalize(provisto));
    if (dep) return dep;
  }
  const depName = CITY_TO_DEPARTMENT[normalize(ciudad ?? "")];
  if (depName) return DEPARTMENT_BY_NORMALIZED.get(normalize(depName)) ?? null;
  return null;
}
