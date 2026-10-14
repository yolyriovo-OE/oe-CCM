// Reglas puras de la Etapa 1: lectura de archivos y cálculo de alertas.
// No tocan la base de datos; reciben un "contexto" con lo que se sabe de cada cédula.
const XLSX = require("xlsx");

const norm = (s) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const cc = (s) => String(s ?? "").replace(/\D/g, "");
const titleCase = (s) => String(s || "").trim().toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());

function teamFromCampaign(s) {
  const o = norm(s);
  const map = [
    ["junior", "Junior"], ["promo", "Promo"], ["spain", "España"], ["espana", "España"], ["svt", "SVT"],
    ["verification", "SVT"], ["2nd", "Segundo Año"], ["segundo", "Segundo Año"], ["second", "Segundo Año"],
    ["reten", "Retención"], ["collection", "Cobranzas"], ["cobranza", "Cobranzas"], ["b2b", "B2B"], ["b2g", "B2B"],
    ["bootcamp", "Bootcamp"], ["no phone", "No Phone"], ["no_phone", "No Phone"], ["social", "No Phone"],
    ["phone", "No Phone"], ["turk", "Turquía"], ["brazil", "Adultos BR"], ["brasil", "Adultos BR"], ["adult", "Adultos"],
  ];
  for (const [k, v] of map) if (o.includes(k)) return v;
  return String(s || "").trim();
}

const rowsOf = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

/* ---------- Libro de ingresos ---------- */
const COLS = {
  cedula: ["cedula", "cpf"], fecha: ["fecha de inicio", "data de inicio"], nombres: ["nombres", "nomes"],
  apellidos: ["apellidos", "sobrenomes"], link: ["link hoja de vida", "link do curriculo"],
  resumen: ["resumen actividades", "resumo das atividades"], reintegro: ["reintegro", "reintegracao"],
  disponibilidad: ["disponibilidad", "disponibilidade"], educacion: ["nivel educativo", "nivel educacional"],
  meses: ["tiempo en la ultima empresa", "tempo na ultima empresa"], empresa: ["ultima empresa"],
  fuente: ["fuente de reclutamiento", "fonte de recrutamento"], wave: ["wave"],
};

function parseLibro(wb) {
  const withRows = (n) => rowsOf(wb.Sheets[n]).filter((r) => r.some(Boolean)).length > 2;
  const name =
    wb.SheetNames.find((n) => /ingresos\s*(esp|br)/i.test(n) && withRows(n)) ||
    wb.SheetNames.find((n) => /ingresos/i.test(n)) ||
    wb.SheetNames[0];
  const rows = rowsOf(wb.Sheets[name]);
  const hi = rows.findIndex((r) => r.some((c) => ["cedula", "cpf"].includes(norm(c))));
  if (hi < 0) throw new Error(`No encontré la columna CEDULA o CPF en la hoja "${name}".`);
  const H = rows[hi].map(norm);
  const ix = {};
  for (const [k, alts] of Object.entries(COLS)) {
    const i = H.findIndex((h) => alts.some((a) => h === a || h.startsWith(a)));
    if (i >= 0) ix[k] = i;
  }
  const asesores = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.some((c) => /^retiros$/i.test(String(c).trim()))) break;
    const g = (k) => (ix[k] != null ? String(row[ix[k]] ?? "").trim() : "");
    const ced = cc(g("cedula"));
    if (!ced && !g("nombres")) continue;
    asesores.push({
      cedula: ced, fecha: g("fecha"), nombre: `${g("nombres")} ${g("apellidos")}`.replace(/\s+/g, " ").trim(),
      reintegro: norm(g("reintegro")), disponibilidad: g("disponibilidad"), educacion: g("educacion"),
      meses: g("meses"), empresa: g("empresa"), fuente: g("fuente"), wave: g("wave"), link: g("link"),
    });
  }
  return { hoja: name, asesores };
}

/* ---------- HC Master ---------- */
const QUIT_TEAM = {
  OE_Adultos_Quit: "Adultos", OE_Adulto_Spain_Quit: "España", OE_Promo_Quit: "Promo", OE_Junior_Quit: "Junior",
  OE_Junior_Promo_Quit: "Junior", SVT_Quit: "SVT", "2nd_Year_Quit": "Segundo Año", No_Phone_Quit: "No Phone",
  Phone_Quit: "No Phone", Social_Media_Quit: "No Phone", B2B_Quit: "B2B", B2G_Quit: "B2B",
  Collection_Quit: "Cobranzas", Retention_Quit: "Retención", Postsales_Quit: "Postventa",
};
// Recibe las hojas como [{nombre, filas}] para servir tanto al archivo subido como al Google Sheet
function parseHCSheets(sheets) {
  const idx = new Map();
  const add = (c, n, t, e, f, hoja) => {
    c = cc(c);
    if (c.length < 6 || c.length > 12) return;
    const cur = idx.get(c);
    if (cur && cur.estado === "activo" && e !== "activo") return; // activo gana
    idx.set(c, { cedula: c, nombre: titleCase(n), equipo: t, estado: e, fecha_retiro: String(f || "").trim(), hoja });
  };
  for (const { nombre: sn, filas: rows } of sheets) {
    if (!(sn === "Activos" || sn === "Retiros" || sn.endsWith("_Quit"))) continue;
    if (!rows.length) continue;
    const H = rows[0].map(norm);
    const ci = H.indexOf("cc"), ni = H.indexOf("agent name"), qi = H.indexOf("date quit"),
      oi = H.indexOf("operation"), ai = H.indexOf("area");
    if (ci < 0 || ni < 0) continue;
    for (const r of rows.slice(1)) {
      if (sn === "Activos") add(r[ci], r[ni], teamFromCampaign(oi >= 0 ? r[oi] : ""), "activo", "", sn);
      else add(r[ci], r[ni], QUIT_TEAM[sn] || teamFromCampaign(`${ai >= 0 ? r[ai] : ""} ${r[9] || ""}`), "retirado", qi >= 0 ? r[qi] : "", sn);
    }
  }
  if (idx.size < 50) throw new Error("No encontré las hojas Activos / Retiros con las columnas CC y Agent Name.");
  return [...idx.values()];
}
const parseHC = (wb) => parseHCSheets(wb.SheetNames.map((n) => ({ nombre: n, filas: rowsOf(wb.Sheets[n]) })));

/* ---------- No graduados ---------- */
const parseNoGraduados = (wb) => parseNoGraduadosRows(rowsOf(wb.Sheets[wb.SheetNames[0]]));
function parseNoGraduadosRows(rows) {
  const hi = rows.findIndex((r) => r.map(norm).includes("cedula"));
  if (hi < 0) throw new Error("No encontré la columna CEDULA.");
  const H = rows[hi].map(norm);
  const g = (r, n) => {
    const i = H.findIndex((h) => h.startsWith(n));
    return i >= 0 ? String(r[i] ?? "").trim() : "";
  };
  const out = rows.slice(hi + 1).map((r) => ({
    cedula: cc(g(r, "cedula")), nombre: titleCase(`${g(r, "nombres")} ${g(r, "apellidos")}`),
    equipo: teamFromCampaign(g(r, "campana")), wave: g(r, "wave"), resultado: g(r, "resultado final"),
    fecha_inicio: g(r, "fecha de inicio"), estado_caso: g(r, "estado de caso"),
  })).filter((x) => x.cedula.length >= 6);
  if (!out.length) throw new Error("El archivo no tiene filas con cédula.");
  return out;
}

/* ---------- Revisión previa de una cédula ----------
 ctx = { hc: Map<cedula,{nombre,equipo,estado,fecha_retiro}>, ng: Map<cedula,[...]>,
         desbloqueos: Map<cedula,{estado,...}>,
         candidatos: Map<cedula,[{id,equipo,estado,creado_en,recomendacion}]> } */
function prechecks(cedula, nombre, equipo, ctx, { reintegroReportado = false, ignorarCandidatoId = null } = {}) {
  const out = [];
  const c = cc(cedula);
  if (!c) return out;
  const ng = ctx.ng.get(c);
  const des = ctx.desbloqueos.get(c);
  if (ng && !(des && des.estado === "aprobado"))
    out.push({
      tipo: "bloqueado", sev: "crit", titulo: "Bloqueado · contratado antes y no se graduó",
      msg: ng.map((x) => `${x.equipo || "Equipo ?"} wave ${x.wave || "?"} (${x.resultado || x.estado_caso || "sin resultado"})${x.fecha_inicio ? `, inicio ${x.fecha_inicio}` : ""}`).join(" · "),
    });
  if (ng && des && des.estado === "aprobado")
    out.push({ tipo: "desbloqueado", sev: "info", titulo: "Desbloqueo aprobado", msg: des.comentario || "" });

  const h = ctx.hc.get(c);
  if (h && !reintegroReportado)
    out.push({
      tipo: h.estado === "activo" ? "activo_hc" : "reintegro", sev: "crit",
      titulo: h.estado === "activo" ? "Ya figura activo en el HC" : "Posible reintegro",
      msg: `${h.nombre} · ${h.equipo || "equipo sin dato"}${h.estado === "retirado" ? ` · retiro ${h.fecha_retiro || "sin fecha"}` : ""}`,
    });
  // Los reintegros se detectan SOLO contra el HC Master (no contra libros de ingreso ni waves de la app).

  const tokens = norm(nombre).split(" ").filter((t) => t.length > 2);
  const distinto = (otro) => tokens.length && otro && !tokens.some((t) => norm(otro).includes(t));
  const dup = [...(ng || []).map((x) => x.nombre), h?.nombre].filter(Boolean).find(distinto);
  if (dup)
    out.push({ tipo: "duplicada", sev: "crit", titulo: "Cédula duplicada · verificar identidad", msg: `La misma cédula aparece registrada a nombre de ${dup}.` });

  const otros = (ctx.candidatos.get(c) || []).filter((x) => x.id !== ignorarCandidatoId && x.estado !== "contratado");
  const otroEquipo = otros.find((x) => x.equipo !== equipo);
  if (otroEquipo)
    out.push({ tipo: "otro_equipo", sev: "media", titulo: "También aplica a otro equipo", msg: `Tiene screening en ${otroEquipo.equipo} (${otroEquipo.estado}).` });
  else if (otros.length)
    out.push({ tipo: "ya_en_proceso", sev: "info", titulo: "Ya tiene un screening en este equipo", msg: `${otros.length} registro(s) previo(s).` });
  return out;
}

/* ---------- Escala AAA / AA / Regular (ficha de contratación del perfil) ----------
 AAA: experiencia en ventas + Consistencia + Responsabilidad
 AA: experiencia + Consistencia, sin Responsabilidad
 Regular (no deseado): experiencia, sin Consistencia ni Responsabilidad
 No avanza: sin el mínimo de experiencia en ventas (es el must)
 Caso que la escala no define (Responsabilidad sí, Consistencia no): AA con "Consistencia por verificar". */
const UMBRAL = 0.75;
function bloque(marcas) {
  const total = (marcas || []).length;
  const si = (marcas || []).filter(Boolean).length;
  return { si, total, cumple: total > 0 && si / total >= UMBRAL };
}
function clasificar({ experiencia, consistencia, responsabilidad }) {
  // experiencia: true | false | null ; consistencia/responsabilidad: true | false | null (null = sin evaluar)
  if (experiencia === false) return { nivel: "No avanza", motivo: "No cumple el mínimo de experiencia en ventas (must)." };
  const pend = [experiencia == null && "experiencia en ventas", consistencia == null && "Consistencia", responsabilidad == null && "Responsabilidad"].filter(Boolean);
  if (pend.length) {
    const tope = consistencia === false ? (responsabilidad === true ? "AA" : "Regular") : responsabilidad === false ? "AA" : "AAA";
    return { nivel: "", tope, pendiente: pend, motivo: `Falta evaluar: ${pend.join(", ")}. Como máximo podría ser ${tope}.` };
  }
  if (consistencia && responsabilidad) return { nivel: "AAA", motivo: "Cumple experiencia, Consistencia y Responsabilidad." };
  if (consistencia) return { nivel: "AA", motivo: "No cumple Responsabilidad." };
  if (responsabilidad) return { nivel: "AA", motivo: "Consistencia por verificar: cumple Responsabilidad pero no Consistencia (caso que la escala no define)." };
  return { nivel: "Regular", motivo: "No cumple Consistencia ni Responsabilidad (perfil no deseado)." };
}
// Lectura preliminar desde la hoja de vida: experiencia y consistencia; Responsabilidad siempre queda para la entrevista
function clasificacionPrevia(ia, perfil) {
  const meses = Number.isFinite(ia?.experiencia_ventas_meses) ? ia.experiencia_ventas_meses : null;
  const mustVentas = (ia?.must || []).find((m) => /venta/i.test(m.criterio) && /(año|12|mes)/i.test(m.criterio));
  const experiencia = meses != null ? meses >= 12 : mustVentas ? (mustVentas.estado === "cumple" ? true : mustVentas.estado === "no_cumple" ? false : null) : null;
  const max = ia?.consistencia?.max_meses_un_empleo;
  const consistencia = Number.isFinite(max) ? max >= (perfil?.consistencia_meses || 12) : null;
  return { experiencia, consistencia, ...clasificar({ experiencia, consistencia, responsabilidad: null }) };
}

/* ---------- Mapa de habilidades ---------- */
const COMP_KEYS = ["responsabilidad", "consistencia", "apego", "valor", "frustracion", "resultados"];
// % de conductas observadas por competencia (null = no evaluada)
function mapaHabilidades(checklist) {
  const out = {};
  for (const k of COMP_KEYS) {
    const m = checklist?.[k];
    out[k] = Array.isArray(m) && m.length ? Math.round((m.filter(Boolean).length / m.length) * 100) : null;
  }
  return out;
}

/* ---------- Evaluación del libro de ingresos ---------- */
const EDU_OK = ["bachiller", "tecnico", "tecnologo", "pregrado", "profesional", "universitario", "posgrado", "especializacion", "maestria", "ensino medio", "superior"];

function evaluarLibro(libro, perfil, ctx) {
  const alerts = [];
  const seen = new Map();
  const exigeBachiller = perfil.must.some((m) => /bachiller/i.test(m));
  for (const a of libro.asesores) {
    const base = { cedula: a.cedula, nombre: a.nombre, equipo: libro.equipo, wave: libro.wave };
    if (!a.cedula) {
      alerts.push({ ...base, tipo: "sin_cedula", sev: "crit", titulo: "Fila sin cédula", msg: "No se pueden revisar bloqueos ni reintegros sin cédula." });
      continue;
    }
    if (seen.has(a.cedula))
      alerts.push({ ...base, tipo: "duplicada_libro", sev: "crit", titulo: "Cédula repetida en el libro", msg: `También está en la fila de ${seen.get(a.cedula)}.` });
    seen.set(a.cedula, a.nombre);

    const rep = a.reintegro.startsWith("si") || a.reintegro.startsWith("sim");
    for (const p of prechecks(a.cedula, a.nombre, libro.equipo, ctx, { reintegroReportado: rep })) {
      if (["ya_en_proceso", "desbloqueado", "otro_equipo"].includes(p.tipo)) continue;
      const reint = p.tipo === "reintegro" || p.tipo === "activo_hc";
      alerts.push({ ...base, tipo: reint ? "reintegro_no_reportado" : p.tipo, sev: p.sev, titulo: reint && p.tipo === "reintegro" ? "Reintegro no reportado" : p.titulo, msg: p.msg });
    }

    // El screening válido es el del MISMO equipo al que ingresa
    const cands = (ctx.candidatos.get(a.cedula) || []).sort((x, y) => String(y.creado_en).localeCompare(String(x.creado_en)));
    const mismo = cands.find((c) => c.equipo === libro.equipo);
    if (!mismo) {
      const otro = cands[0];
      alerts.push({
        ...base, tipo: "sin_screening", sev: "media",
        titulo: otro ? "Screening hecho para otro equipo" : "Contratado sin screening en la app",
        msg: otro ? `Se evaluó para ${otro.equipo}, no para ${libro.equipo}.` : "No hay hoja de vida analizada para esta cédula en este equipo.",
      });
    } else if (mismo.recomendacion === "no_cumple_must") {
      alerts.push({ ...base, tipo: "contratado_sin_must", sev: "crit", titulo: "Contratado sin cumplir el must", msg: `El screening de ${libro.equipo} lo marcó como no cumple.` });
    }
    if (mismo) {
      const n = mismo.clasificacion;
      if (!n) alerts.push({ ...base, tipo: "sin_clasificacion", sev: "media", titulo: "Contratado sin clasificación AAA", msg: `No se llenó el checklist de entrevista.${mismo.clasificacion_previa ? ` Lectura de la hoja de vida: ${mismo.clasificacion_previa}.` : ""}` });
      else if (n === "No avanza" || n === "Regular") alerts.push({ ...base, tipo: "contratado_no_aaa", sev: "crit", titulo: `Contratado con perfil ${n}`, msg: n === "Regular" ? "Perfil no deseado: no cumple Consistencia ni Responsabilidad." : "No cumple la experiencia mínima en ventas." });
      else if (n === "AA") alerts.push({ ...base, tipo: "contratado_no_aaa", sev: "media", titulo: "Contratado con perfil AA (no AAA)", msg: "No cumple uno de los bloques de la entrevista." });
      const rjp = mismo.rjp;
      if (!rjp || !(rjp.items || []).every(Boolean))
        alerts.push({ ...base, tipo: "sin_rjp", sev: "media", titulo: "Contratado sin descripción realista del puesto", msg: rjp ? `Se explicaron ${(rjp.items || []).filter(Boolean).length} de ${(rjp.items || []).length} puntos.` : "No se registró que se le explicaran meta, horarios, comisión y presión del cargo." });
      else if (rjp.reaccion === "preocupa")
        alerts.push({ ...base, tipo: "rjp_riesgo", sev: "media", titulo: "Riesgo de expectativas", msg: `Al conocer las condiciones del cargo mostró preocupación${rjp.nota ? `: ${rjp.nota}` : "."}` });
    }

    if (exigeBachiller) {
      const e = norm(a.educacion);
      if (!e) alerts.push({ ...base, tipo: "dato_vacio", sev: "media", titulo: "Nivel educativo vacío", msg: `El perfil de ${libro.equipo} exige bachiller completo.` });
      else if (!EDU_OK.some((k) => e.includes(k)))
        alerts.push({ ...base, tipo: "educacion", sev: "crit", titulo: "No cumple escolaridad mínima", msg: `Nivel educativo: ${a.educacion}. El perfil de ${libro.equipo} exige bachiller completo.` });
    }
    if (!a.disponibilidad)
      alerts.push({ ...base, tipo: "dato_vacio", sev: "media", titulo: "Disponibilidad vacía", msg: "La disponibilidad para el turno es requisito obligatorio." });
    const m = parseFloat(String(a.meses).replace(",", "."));
    if (!isNaN(m) && m < (perfil.consistencia_meses || 12))
      alerts.push({ ...base, tipo: "consistencia", sev: "info", titulo: "Consistencia por verificar", msg: `${m} meses en la última empresa (${a.empresa || "sin empresa"}).` });
    if (!a.fecha)
      alerts.push({ ...base, tipo: "dato_vacio", sev: "media", titulo: "Fecha de inicio vacía", msg: "Completa la fecha de inicio en el libro." });
  }
  return alerts;
}

function waveId(equipo, wave, asesores) {
  const f = asesores.find((a) => a.fecha)?.fecha || "";
  const y = (f.match(/(\d{4})/) || [, new Date().getFullYear()])[1];
  const w = String(parseInt(wave, 10) || wave).padStart(2, "0");
  const k = norm(equipo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${k}_${y}_w${w}`;
}

module.exports = { mapaHabilidades, COMP_KEYS, clasificar, clasificacionPrevia, bloque, norm, cc, teamFromCampaign, parseLibro, parseHC, parseHCSheets, parseNoGraduadosRows, parseNoGraduados, prechecks, evaluarLibro, waveId, XLSX };
