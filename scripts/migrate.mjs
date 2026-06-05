// Runner de migraciones para Nitro Bot.
// Aplica los .sql de supabase/migrations en orden, una sola vez cada uno,
// registrando los aplicados en la tabla _migrations. Usa la conexión directa
// a Postgres definida por variables discretas en .env.local.
//
//   node scripts/migrate.mjs          -> aplica las pendientes
//   node scripts/migrate.mjs --status -> solo muestra estado, no aplica

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

// --- cargar .env.local (parser simple, tolerante a caracteres especiales) ---
function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const statusOnly = process.argv.includes("--status");

const client = new pg.Client({
  host: env.SUPABASE_DB_HOST,
  port: Number(env.SUPABASE_DB_PORT),
  user: env.SUPABASE_DB_USER,
  password: env.SUPABASE_DB_PASSWORD,
  database: env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query("select name from _migrations")).rows.map((r) => r.name)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Migraciones encontradas: ${files.length}`);
  let pending = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ✓ ${file} (ya aplicada)`);
      continue;
    }
    pending++;
    if (statusOnly) {
      console.log(`  • ${file} (PENDIENTE)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`  → aplicando ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations(name) values($1)", [file]);
      await client.query("commit");
      console.log("OK ✅");
    } catch (e) {
      await client.query("rollback");
      console.log("FALLÓ ❌");
      console.error(`\nError en ${file}:\n${e.message}\n`);
      process.exit(1);
    }
  }

  if (pending === 0) console.log("Todo al día. Nada que aplicar.");
  else if (statusOnly) console.log(`\n${pending} migración(es) pendiente(s).`);
  else console.log(`\nListo: ${pending} migración(es) aplicada(s).`);

  await client.end();
}

main().catch((e) => {
  console.error("Error fatal:", e.message);
  process.exit(1);
});
