// Arma el contexto de reglas (bloqueos, HC Master, candidatos) para un grupo de cédulas.
const { q } = require("./db");

async function buildCtx(cedulas) {
  const list = [...new Set(cedulas.filter(Boolean))];
  const ctx = { hc: new Map(), ng: new Map(), desbloqueos: new Map(), candidatos: new Map() };
  if (!list.length) return ctx;
  const [hc, ng, des, cand] = await Promise.all([
    q(`SELECT * FROM hc_ref WHERE cedula = ANY($1)`, [list]),
    q(`SELECT * FROM no_graduados WHERE cedula = ANY($1) ORDER BY id`, [list]),
    q(`SELECT * FROM desbloqueos WHERE cedula = ANY($1)`, [list]),
    q(`SELECT id, cedula, equipo, estado, recomendacion, clasificacion, clasificacion_previa, rjp, creado_en FROM candidatos WHERE cedula = ANY($1)`, [list]),
  ]);
  hc.rows.forEach((r) => ctx.hc.set(r.cedula, r));
  const push = (m, k, v) => m.set(k, [...(m.get(k) || []), v]);
  ng.rows.forEach((r) => push(ctx.ng, r.cedula, r));
  des.rows.forEach((r) => ctx.desbloqueos.set(r.cedula, r));
  cand.rows.forEach((r) => push(ctx.candidatos, r.cedula, { ...r, creado_en: r.creado_en.toISOString() }));
  return ctx;
}

async function perfilDe(equipo) {
  const r = await q(`SELECT * FROM perfiles WHERE equipo = $1`, [equipo]);
  return r.rows[0] || null;
}

module.exports = { buildCtx, perfilDe };
