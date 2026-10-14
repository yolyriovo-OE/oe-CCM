// Bases principales de las alertas, leídas automáticamente de Google Sheets:
//  - HC Master (reintegros)
//  - "Asesores Pendientes de las Wave OB y OJT Ya graduados" (no graduados → bloqueo)
// Si una cédula que está en proceso en la app aparece en no graduados, la alerta sale de inmediato.
const { GoogleAuth } = require("google-auth-library");
const { q, tx } = require("./db");
const R = require("./rules");

const SHEET_ID = process.env.HC_SHEET_ID || "1ZsYdjStmNCVAoyuc4MrgzgNrPO1CQlPkpe8vE5LYuU4";
const NG_SHEET_ID = process.env.NG_SHEET_ID || "1CuR4pEL_KxW7PREYSv856efIu2TgSeRhn36WtUwI5tk";
const HOURS = Math.max(1, Number(process.env.HC_SYNC_HOURS || 6));
const NG_MINUTES = Math.max(5, Number(process.env.NG_SYNC_MINUTES || 30));
const API = "https://sheets.googleapis.com/v4/spreadsheets/";

let client = null;
function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido. Pega el contenido completo del archivo .json de la cuenta de servicio."); }
}
const enabled = () => !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const serviceEmail = () => { try { return credentials()?.client_email || ""; } catch { return ""; } };

async function api(url, nombreArchivo) {
  if (!client) client = await new GoogleAuth({ credentials: credentials(), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] }).getClient();
  try {
    return (await client.request({ url })).data;
  } catch (e) {
    const st = e.response?.status;
    if (st === 403 || st === 404)
      throw new Error(`Sin acceso a "${nombreArchivo}". Compártelo como Lector con ${serviceEmail()} y verifica que la API de Google Sheets esté habilitada.`);
    throw new Error(`Google Sheets respondió con error${st ? ` ${st}` : ""}: ${e.message}`);
  }
}
async function leerHojas(id, filtro, nombreArchivo) {
  const meta = await api(`${API}${id}?fields=sheets.properties.title`, nombreArchivo);
  const titles = meta.sheets.map((s) => s.properties.title).filter(filtro);
  const hojas = [];
  for (let i = 0; i < titles.length; i += 15) {
    const part = titles.slice(i, i + 15);
    const qs = part.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join("&");
    const data = await api(`${API}${id}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, nombreArchivo);
    data.valueRanges.forEach((vr, k) => hojas.push({ nombre: part[k], filas: (vr.values || []).map((r) => r.map((c) => String(c ?? ""))) }));
  }
  return hojas;
}

async function meta(clave, total, usuarioId, fuente, error = "") {
  await q(
    `INSERT INTO ref_meta (clave,total,actualizado_por,actualizado_en,fuente,error) VALUES ($1,$2,$3,now(),$4,$5)
     ON CONFLICT (clave) DO UPDATE SET total=$2, actualizado_por=$3, actualizado_en=now(), fuente=$4, error=$5`,
    [clave, total, usuarioId || null, fuente, error]
  );
}
const metaError = (clave, fuente, msg) =>
  q(`INSERT INTO ref_meta (clave,total,fuente,error) VALUES ($1,0,$2,$3) ON CONFLICT (clave) DO UPDATE SET error=$3`, [clave, fuente, msg]).catch(() => {});

/* ---------- HC Master ---------- */
async function guardarHC(rows, usuarioId, fuente) {
  await tx(async (c) => {
    await c.query(`TRUNCATE hc_ref`);
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      await c.query(
        `INSERT INTO hc_ref (cedula,nombre,equipo,estado,fecha_retiro,hoja)
         SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[]) ON CONFLICT DO NOTHING`,
        ["cedula", "nombre", "equipo", "estado", "fecha_retiro", "hoja"].map((k) => chunk.map((r) => r[k]))
      );
    }
  });
  await meta("hc", rows.length, usuarioId, fuente);
  return rows.length;
}

/* ---------- No graduados ---------- */
// Guarda la lista y devuelve las cédulas que no estaban antes
async function guardarNG(rows, usuarioId, fuente) {
  const antes = new Set((await q(`SELECT DISTINCT cedula FROM no_graduados`)).rows.map((r) => r.cedula));
  await tx(async (c) => {
    await c.query(`TRUNCATE no_graduados`);
    for (const r of rows)
      await c.query(`INSERT INTO no_graduados (cedula,nombre,equipo,wave,resultado,fecha_inicio,estado_caso) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.cedula, r.nombre, r.equipo, r.wave, r.resultado, r.fecha_inicio, r.estado_caso]);
  });
  await meta("no_graduados", rows.length, usuarioId, fuente);
  const nuevas = [...new Set(rows.map((r) => r.cedula))].filter((c) => !antes.has(c));
  await alertarNuevosNG(nuevas, rows, usuarioId, antes.size === 0);
  return rows.length;
}

// Alerta inmediata: cédulas que entran a "no graduados" y que la app tiene en proceso o contratadas
async function alertarNuevosNG(nuevas, rows, usuarioId, primeraCarga) {
  if (!nuevas.length) return;
  const alerts = require("./alerts");
  const cands = (await q(
    `SELECT DISTINCT ON (cedula, equipo) id, cedula, nombre, equipo, estado FROM candidatos
     WHERE cedula = ANY($1) AND estado NOT IN ('descartado','bloqueado') ORDER BY cedula, equipo, creado_en DESC`, [nuevas])).rows;
  const list = cands.map((c) => {
    const ng = rows.filter((r) => r.cedula === c.cedula);
    return {
      tipo: "aparece_no_graduados", sev: "crit", titulo: "Aparece en Asesores Pendientes (no graduados)",
      msg: `${ng.map((x) => `${x.equipo} W${x.wave} · ${x.resultado || x.estado_caso || "en seguimiento"}`).join(" | ")}. Estado en la app: ${c.estado}.`,
      cedula: c.cedula, nombre: c.nombre || ng[0]?.nombre || "", equipo: c.equipo, candidatoId: c.id,
    };
  });
  if (list.length) await alerts.registrar(list, primeraCarga ? "Cédulas en proceso que figuran como no graduadas" : "Nueva cédula en Asesores Pendientes", usuarioId);
}

/* ---------- Sincronización ---------- */
const running = {};
function once(key, fn) {
  if (running[key]) return running[key];
  return (running[key] = fn().finally(() => { running[key] = null; }));
}
function exigir() { if (!enabled()) throw new Error("La lectura automática no está configurada: falta GOOGLE_SERVICE_ACCOUNT_JSON en Railway."); }

function sincronizar(usuarioId = null) {
  exigir();
  return once("hc", async () => {
    const F = "Google Sheet HC Master (automático)";
    try {
      const hojas = await leerHojas(SHEET_ID, (t) => t === "Activos" || t === "Retiros" || t.endsWith("_Quit"), "HC Master");
      if (!hojas.some((h) => h.nombre === "Activos")) throw new Error('El HC Master no tiene la hoja "Activos".');
      const n = await guardarHC(R.parseHCSheets(hojas), usuarioId, F);
      console.log(`HC Master sincronizado: ${n} cédulas`);
      return n;
    } catch (e) { await metaError("hc", F, e.message); console.error("HC Master:", e.message); throw e; }
  });
}
function sincronizarNG(usuarioId = null) {
  exigir();
  return once("ng", async () => {
    const F = "Google Sheet Asesores Pendientes (automático)";
    try {
      const hojas = await leerHojas(NG_SHEET_ID, () => true, "Asesores Pendientes de las Wave OB y OJT");
      const rows = R.parseNoGraduadosRows(hojas[0]?.filas || []);
      const n = await guardarNG(rows, usuarioId, F);
      console.log(`No graduados sincronizados: ${n} registros`);
      return n;
    } catch (e) { await metaError("no_graduados", F, e.message); console.error("No graduados:", e.message); throw e; }
  });
}

function programar() {
  if (!enabled()) return console.log("Lectura automática de Google Sheets desactivada (sin GOOGLE_SERVICE_ACCOUNT_JSON).");
  sincronizar().catch(() => {});
  sincronizarNG().catch(() => {});
  setInterval(() => sincronizar().catch(() => {}), HOURS * 3600 * 1000).unref();
  setInterval(() => sincronizarNG().catch(() => {}), NG_MINUTES * 60 * 1000).unref();
}

module.exports = { sincronizar, sincronizarNG, programar, guardarHC, guardarNG, enabled, serviceEmail, SHEET_ID, NG_SHEET_ID, HOURS, NG_MINUTES };
