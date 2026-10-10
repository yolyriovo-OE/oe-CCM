const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { PERFIL_ADULTOS } = require("./constants");

const url = process.env.DATABASE_URL || "";
// En Railway la red privada (postgres.railway.internal) no usa SSL; el proxy público sí puede pedirlo.
const ssl = /sslmode=require/.test(url) || process.env.PGSSL === "1" ? { rejectUnauthorized: false } : false;
const pool = url ? new Pool({ connectionString: url, ssl, max: 10, connectionTimeoutMillis: 10000 }) : null;

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function migrate() {
  await q(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  // Perfil base de Adultos (de "Perfil exitoso OE Adultos Latam"); no pisa ediciones posteriores
  await q(
    `INSERT INTO perfiles (equipo, must, evaluar, no_pedir, consistencia_meses)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (equipo) DO NOTHING`,
    ["Adultos", PERFIL_ADULTOS.must, PERFIL_ADULTOS.evaluar, PERFIL_ADULTOS.noPedir, PERFIL_ADULTOS.consistenciaMeses]
  );
  await q(`INSERT INTO destinos (equipo) VALUES ('*') ON CONFLICT DO NOTHING`);
  await q(`DELETE FROM libro_previews WHERE creado_en < now() - interval '2 days'`);
}

module.exports = { pool, q, tx, migrate };
