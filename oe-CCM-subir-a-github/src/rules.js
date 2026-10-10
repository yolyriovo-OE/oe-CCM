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
function parseHC(wb) {
  const idx = new Map();
  const add = (c, n, t, e, f, hoja) => {
    c = cc(c);
    if (c.length < 6 || c.length > 12) return;
    const cur = idx.get(c);
    if (cur && cur.estado === "activo" && e !== "activo") return; // activo gana
    idx.set(c, { cedula: c, nombre: titleCase(n), equipo: t, estado: e, fecha_retiro: String(f || "").trim(), hoja });
  };
  for (const sn of wb.SheetNames) {
    if (!(sn === "Activos" || sn === "Retiros" || sn.endsWith("_Quit"))) continue;
    const rows = rowsOf(wb.Sheets[sn]);
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

/* ---------- No graduados ---------- */
function parseNoGraduados(wb) {
  const rows = rowsOf(wb.Sheets[wb.SheetNames[0]]);
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
         desbloqueos: Map<cedula,{estado,...}>, waves: Map<cedula,[{equipo,wave,fecha_inicio,wave_id}]>,
         candidatos: Map<cedula,[{id,equipo,estado,creado_en,recomendacion}]> } */
function prechecks(cedula, nombre, equipo, ctx, { reintegroReportado = false, ignorarCandidatoId = null, waveActual = null } = {}) {
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
  const prev = (ctx.waves.get(c) || []).filter((w) => w.wave_id !== waveActual);
  if (prev.length && !reintegroReportado)
    out.push({
      tipo: "reintegro", sev: "crit", titulo: "Ya ingresó en una wave anterior",
      msg: prev.map((w) => `${w.equipo} wave ${w.wave} (${w.fecha_inicio || ""})`).join(" · "),
    });

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
    for (const p of prechecks(a.cedula, a.nombre, libro.equipo, ctx, { reintegroReportado: rep, waveActual: libro.waveId })) {
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

module.exports = { norm, cc, teamFromCampaign, parseLibro, parseHC, parseNoGraduados, prechecks, evaluarLibro, waveId, XLSX };
