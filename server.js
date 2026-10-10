const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const helmet = require("helmet");
const multer = require("multer");
const { OAuth2Client } = require("google-auth-library");

const { pool, q, tx, migrate } = require("./db");
const { EQUIPOS, ROLES, FUENTES } = require("./constants");
const R = require("./rules");
const { buildCtx, perfilDe } = require("./context");
const { screen, MODEL } = require("./screening");
const alerts = require("./alerts");

const PROD = process.env.NODE_ENV === "production";
const DOMAIN = (process.env.ALLOWED_DOMAIN || "openenglish.com").toLowerCase();
const ADMINS = (process.env.ADMIN_EMAILS || "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || "";
const DEV_LOGIN = !PROD && process.env.DEV_LOGIN === "1";
if (PROD && !process.env.SESSION_SECRET) { console.error("Falta SESSION_SECRET."); process.exit(1); }

const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://accounts.google.com/gsi/client"],
      "frame-src": ["https://accounts.google.com"],
      "connect-src": ["'self'", "https://accounts.google.com"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com/gsi/style"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "https://*.googleusercontent.com"],
    },
  },
}));
app.use(express.json({ limit: "2mb" }));
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: 1000 * 60 * 60 * 12 },
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/* ---------- utilidades ---------- */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const teamsOf = (u) => (u.rol === "admin" ? EQUIPOS : u.equipos || []);
function assertTeam(u, equipo) {
  if (!EQUIPOS.includes(equipo)) throw fail(400, "Selecciona el equipo al que aplica el candidato.");
  if (!teamsOf(u).includes(equipo)) throw fail(403, `No tienes asignado el equipo ${equipo}.`);
}
const userOut = (u) => ({ id: u.id, email: u.email, nombre: u.nombre, foto: u.foto, rol: u.rol, equipos: teamsOf(u) });

async function loadUser(req, _res, next) {
  if (req.session.uid) {
    const r = await q(`SELECT * FROM usuarios WHERE id = $1 AND activo`, [req.session.uid]);
    req.user = r.rows[0] || null;
  }
  next();
}
app.use(wrap(loadUser));
const need = (...roles) => (req, _res, next) => {
  if (!req.user) return next(fail(401, "Inicia sesión."));
  if (!req.user.rol) return next(fail(403, "Tu usuario está pendiente de rol."));
  if (roles.length && !roles.includes(req.user.rol)) return next(fail(403, "Tu rol no tiene acceso a esta sección."));
  next();
};

/* ---------- autenticación ---------- */
const gclient = new OAuth2Client(GOOGLE_ID);
async function upsertUser({ email, nombre, foto }) {
  email = email.toLowerCase();
  const r = await q(
    `INSERT INTO usuarios (email, nombre, foto, rol, ultimo_acceso) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, foto = EXCLUDED.foto, ultimo_acceso = now(),
       rol = COALESCE(usuarios.rol, EXCLUDED.rol)
     RETURNING *`,
    [email, nombre || "", foto || "", ADMINS.includes(email) ? "admin" : null]
  );
  return r.rows[0];
}
app.post("/auth/google", wrap(async (req, res) => {
  if (!GOOGLE_ID) throw fail(503, "Falta GOOGLE_CLIENT_ID en las variables de Railway.");
  const ticket = await gclient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_ID }).catch(() => null);
  const p = ticket?.getPayload();
  if (!p || !p.email_verified) throw fail(401, "No se pudo verificar la cuenta de Google.");
  const dom = (p.hd || p.email.split("@")[1] || "").toLowerCase();
  if (dom !== DOMAIN) throw fail(403, `Solo pueden entrar cuentas @${DOMAIN}.`);
  const u = await upsertUser({ email: p.email, nombre: p.name, foto: p.picture });
  if (!u.activo) throw fail(403, "Tu usuario está desactivado.");
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "No se pudo iniciar sesión." });
    req.session.uid = u.id;
    res.json({ user: userOut(u) });
  });
}));
if (DEV_LOGIN) {
  app.post("/auth/dev", wrap(async (req, res) => {
    const u = await upsertUser({ email: req.body.email, nombre: req.body.nombre || req.body.email });
    req.session.uid = u.id;
    res.json({ user: userOut(u) });
  }));
}
app.post("/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/me", (req, res) => {
  res.json({
    user: req.user ? userOut(req.user) : null,
    config: { googleClientId: GOOGLE_ID, dominio: DOMAIN, devLogin: DEV_LOGIN, equipos: EQUIPOS, roles: ROLES, fuentes: FUENTES, modelo: MODEL },
  });
});

/* ---------- perfiles (lectura para mis equipos) ---------- */
app.get("/api/perfiles", need(), wrap(async (req, res) => {
  const r = await q(`SELECT * FROM perfiles WHERE equipo = ANY($1)`, [teamsOf(req.user)]);
  res.json(r.rows);
}));

/* ---------- screening ---------- */
const candOut = (c) => c && { ...c, pre: c.prechecks };
async function guardarYAlertar({ req, equipo, cedula, nombre, fuente, link, estado, recomendacion, pre, ia }) {
  const r = await q(
    `INSERT INTO candidatos (cedula,nombre,equipo,fuente,link,estado,recomendacion,prechecks,screening,reclutador_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [cedula, nombre || "", equipo, fuente || "", link || "", estado, recomendacion, JSON.stringify(pre), ia ? JSON.stringify(ia) : null, req.user.id]
  );
  const cand = r.rows[0];
  const list = pre.filter((p) => p.sev !== "info").map((p) => ({ ...p, cedula, nombre, equipo, candidatoId: cand.id }));
  if (ia?.recomendacion === "no_cumple_must")
    list.push({ tipo: "no_cumple_must", sev: "media", titulo: `No cumple el must de ${equipo}`, msg: ia.must.filter((m) => m.estado === "no_cumple").map((m) => m.criterio).join(" · ") || ia.razon || "", cedula, nombre, equipo, candidatoId: cand.id });
  await alerts.registrar(list, `Screening · ${nombre || cedula}`, req.user.id);
  return cand;
}
app.post("/api/screening", need("admin", "reclutador"), upload.single("archivo"), wrap(async (req, res) => {
  const { equipo, fuente, link, texto } = req.body;
  assertTeam(req.user, equipo);
  const cedula = R.cc(req.body.cedula);
  if (cedula.length < 6) throw fail(400, "Escribe la cédula o CPF (solo números) para revisar bloqueos.");
  const perfil = await perfilDe(equipo);
  if (!perfil) throw fail(409, `El perfil de ${equipo} no está cargado. Administración debe cargarlo antes de hacer screening para este equipo.`);
  const ctx = await buildCtx([cedula]);
  let nombre = (req.body.nombre || "").trim();
  let pre = R.prechecks(cedula, nombre, equipo, ctx);
  if (pre.some((p) => p.tipo === "bloqueado")) {
    nombre ||= ctx.ng.get(cedula)?.find((x) => x.nombre)?.nombre || "";
    const cand = await guardarYAlertar({ req, equipo, cedula, nombre, fuente, link, estado: "bloqueado", recomendacion: "bloqueado", pre, ia: null });
    return res.json(candOut(cand));
  }
  const ia = await screen(perfil, { file: req.file, texto });
  nombre ||= (ia.nombre || "").trim();
  pre = R.prechecks(cedula, nombre, equipo, ctx);
  const cand = await guardarYAlertar({ req, equipo, cedula, nombre, fuente, link, estado: "screening", recomendacion: ia.recomendacion, pre, ia });
  res.json(candOut(cand));
}));

/* ---------- candidatos ---------- */
app.get("/api/candidatos", need("admin", "reclutador"), wrap(async (req, res) => {
  const teams = req.query.equipo ? [req.query.equipo].filter((e) => teamsOf(req.user).includes(e)) : teamsOf(req.user);
  const params = [teams];
  let sql = `SELECT c.id,c.cedula,c.nombre,c.equipo,c.fuente,c.estado,c.recomendacion,c.prechecks,c.creado_en,c.wave_id,u.nombre AS reclutador
             FROM candidatos c LEFT JOIN usuarios u ON u.id = c.reclutador_id WHERE c.equipo = ANY($1)`;
  if (req.query.estado) { params.push(req.query.estado); sql += ` AND c.estado = $2`; }
  const r = await q(sql + ` ORDER BY c.creado_en DESC LIMIT 500`, params);
  res.json(r.rows.map(candOut));
}));
app.get("/api/candidatos/:id", need("admin", "reclutador"), wrap(async (req, res) => {
  const r = await q(`SELECT * FROM candidatos WHERE id = $1`, [req.params.id]);
  const c = r.rows[0];
  if (!c) throw fail(404, "No existe ese candidato.");
  assertTeam(req.user, c.equipo);
  res.json(candOut(c));
}));
app.post("/api/candidatos/:id/decision", need("admin", "reclutador"), wrap(async (req, res) => {
  const { estado, comentario = "" } = req.body;
  if (!["entrevista", "espera", "descartado"].includes(estado)) throw fail(400, "Decisión no válida.");
  const c = (await q(`SELECT * FROM candidatos WHERE id = $1`, [req.params.id])).rows[0];
  if (!c) throw fail(404, "No existe ese candidato.");
  assertTeam(req.user, c.equipo);
  if (c.estado === "bloqueado" || c.estado === "contratado") throw fail(409, "Este candidato ya no admite decisión.");
  const r = await q(`UPDATE candidatos SET estado=$1, comentario=$2, decidido_en=now() WHERE id=$3 RETURNING *`, [estado, comentario, c.id]);
  if (estado === "entrevista" && c.recomendacion === "no_cumple_must")
    await alerts.registrar([{ tipo: "avanza_sin_must", sev: "media", titulo: `Pasa a entrevista sin cumplir el must de ${c.equipo}`, msg: comentario || "Sin comentario del reclutador", cedula: c.cedula, nombre: c.nombre, equipo: c.equipo, candidatoId: c.id }], `Decisión · ${c.nombre}`, req.user.id);
  res.json(candOut(r.rows[0]));
}));

/* ---------- desbloqueos ---------- */
app.post("/api/desbloqueos", need("admin", "reclutador"), wrap(async (req, res) => {
  const { candidatoId, motivo = "" } = req.body;
  if (motivo.trim().length < 10) throw fail(400, "Escribe el motivo de la solicitud.");
  const c = (await q(`SELECT * FROM candidatos WHERE id = $1`, [candidatoId])).rows[0];
  if (!c || c.estado !== "bloqueado") throw fail(400, "Solo se pide desbloqueo para un candidato bloqueado.");
  assertTeam(req.user, c.equipo);
  const ng = (await q(`SELECT * FROM no_graduados WHERE cedula = $1`, [c.cedula])).rows;
  const ant = ng.map((x) => `${x.equipo} W${x.wave} · ${x.resultado || x.estado_caso}`).join(" | ");
  await q(
    `INSERT INTO desbloqueos (cedula,nombre,equipo,antecedente,solicitud,candidato_id,solicitado_por,estado,solicitado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pendiente',now())
     ON CONFLICT (cedula) DO UPDATE SET nombre=$2, equipo=$3, antecedente=$4, solicitud=$5, candidato_id=$6, solicitado_por=$7,
       estado='pendiente', solicitado_en=now(), comentario='', resuelto_por=NULL, resuelto_en=NULL`,
    [c.cedula, c.nombre, c.equipo, ant, motivo.trim(), c.id, req.user.id]
  );
  await alerts.registrar([{ tipo: "solicitud_desbloqueo", sev: "media", titulo: "Solicitud de desbloqueo pendiente", msg: `${c.nombre}: ${motivo.trim()}`, cedula: c.cedula, nombre: c.nombre, equipo: c.equipo, candidatoId: c.id }], "Desbloqueo pendiente de aprobación", req.user.id);
  res.json({ ok: true });
}));
app.get("/api/desbloqueos", need("admin", "reclutador", "aprobador"), wrap(async (req, res) => {
  const r = await q(
    `SELECT d.*, us.nombre AS solicitado_por_nombre, ur.nombre AS resuelto_por_nombre FROM desbloqueos d
     LEFT JOIN usuarios us ON us.id = d.solicitado_por LEFT JOIN usuarios ur ON ur.id = d.resuelto_por
     WHERE d.equipo = ANY($1) ORDER BY (d.estado='pendiente') DESC, d.solicitado_en DESC`, [teamsOf(req.user)]);
  res.json(r.rows);
}));
app.post("/api/desbloqueos/:cedula/resolver", need("admin", "aprobador"), wrap(async (req, res) => {
  const { estado, comentario = "" } = req.body;
  if (!["aprobado", "rechazado"].includes(estado)) throw fail(400, "Decisión no válida.");
  if (comentario.trim().length < 5) throw fail(400, "Escribe un comentario para dejar registro.");
  const d = (await q(`SELECT * FROM desbloqueos WHERE cedula = $1`, [req.params.cedula])).rows[0];
  if (!d) throw fail(404, "No existe esa solicitud.");
  assertTeam(req.user, d.equipo);
  if (d.estado !== "pendiente") throw fail(409, "La solicitud ya fue resuelta.");
  await q(`UPDATE desbloqueos SET estado=$1, comentario=$2, resuelto_por=$3, resuelto_en=now() WHERE cedula=$4`, [estado, comentario.trim(), req.user.id, d.cedula]);
  if (estado === "aprobado" && d.candidato_id) await q(`UPDATE candidatos SET estado='espera', comentario=$1 WHERE id=$2 AND estado='bloqueado'`, [`Desbloqueado: ${comentario.trim()}`, d.candidato_id]);
  await alerts.registrar([{ tipo: `desbloqueo_${estado}`, sev: "info", titulo: estado === "aprobado" ? "Desbloqueo aprobado" : "Desbloqueo rechazado", msg: `${d.nombre}: ${comentario.trim()}`, cedula: d.cedula, nombre: d.nombre, equipo: d.equipo }], `Desbloqueo ${estado} · ${d.nombre}`, req.user.id);
  res.json({ ok: true });
}));

/* ---------- libro de ingresos ---------- */
app.post("/api/libro/preview", need("admin", "reclutador"), upload.single("archivo"), wrap(async (req, res) => {
  const { equipo } = req.body;
  assertTeam(req.user, equipo);
  if (!req.file) throw fail(400, "Adjunta el libro de ingresos (.xlsx o .csv).");
  const perfil = await perfilDe(equipo);
  if (!perfil) throw fail(409, `El perfil de ${equipo} no está cargado. Administración debe cargarlo primero.`);
  let wb;
  try { wb = R.XLSX.read(req.file.buffer, { type: "buffer" }); } catch { throw fail(400, "No pude leer el archivo. Descárgalo como .xlsx desde Google Sheets."); }
  const libro = R.parseLibro(wb);
  if (!libro.asesores.length) throw fail(400, `La hoja "${libro.hoja}" no tiene filas de asesores.`);
  const wave = String(req.body.wave || libro.asesores.find((a) => a.wave)?.wave || "").trim();
  if (!wave) throw fail(400, "Escribe el número de wave.");
  const L = { ...libro, equipo, wave, archivo: req.file.originalname, waveId: R.waveId(equipo, wave, libro.asesores) };
  const ctx = await buildCtx(L.asesores.map((a) => a.cedula));
  L.alerts = R.evaluarLibro(L, perfil, ctx);
  const ya = (await q(`SELECT estado, cerrada_en FROM waves WHERE id = $1`, [L.waveId])).rows[0];
  L.yaCerrada = ya?.estado === "sala" ? ya.cerrada_en : null;
  const id = crypto.randomUUID();
  await q(`INSERT INTO libro_previews (id, usuario_id, datos) VALUES ($1,$2,$3)`, [id, req.user.id, JSON.stringify(L)]);
  res.json({ previewId: id, ...L });
}));
app.post("/api/libro/cerrar", need("admin", "reclutador"), wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM libro_previews WHERE id = $1 AND usuario_id = $2`, [req.body.previewId, req.user.id])).rows[0];
  if (!p) throw fail(404, "La vista previa expiró. Sube el libro otra vez.");
  const L = p.datos;
  assertTeam(req.user, L.equipo);
  // Re-evaluar con datos frescos (pudo haber desbloqueos entre la vista previa y el cierre)
  const perfil = await perfilDe(L.equipo);
  const ctx = await buildCtx(L.asesores.map((a) => a.cedula));
  L.alerts = R.evaluarLibro(L, perfil, ctx);
  if (L.alerts.some((a) => a.tipo === "bloqueado")) throw fail(409, "Hay personas bloqueadas sin desbloqueo aprobado. No se puede cerrar la wave.");
  const prev = (await q(`SELECT estado FROM waves WHERE id = $1`, [L.waveId])).rows[0];
  if (prev?.estado === "sala") throw fail(409, `La ${L.equipo} Wave ${L.wave} ya está cerrada. Solo Administración puede reabrirla.`);
  const resumen = { total: L.asesores.length, crit: L.alerts.filter((a) => a.sev === "crit").length, media: L.alerts.filter((a) => a.sev === "media").length };
  await tx(async (c) => {
    await c.query(`DELETE FROM waves WHERE id = $1`, [L.waveId]);
    await c.query(
      `INSERT INTO waves (id,equipo,wave,fecha_inicio,estado,archivo,hoja,resumen,cerrada_por) VALUES ($1,$2,$3,$4,'sala',$5,$6,$7,$8)`,
      [L.waveId, L.equipo, L.wave, L.asesores.find((a) => a.fecha)?.fecha || "", L.archivo, L.hoja, JSON.stringify(resumen), req.user.id]
    );
    for (const a of L.asesores.filter((x) => x.cedula)) {
      await c.query(
        `INSERT INTO wave_asesores (wave_id,cedula,nombre,fecha_inicio,educacion,meses_ultima,disponibilidad,reintegro,fuente,alertas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [L.waveId, a.cedula, a.nombre, a.fecha, a.educacion, a.meses, a.disponibilidad, a.reintegro, a.fuente, L.alerts.filter((x) => x.cedula === a.cedula).map((x) => x.tipo)]
      );
      await c.query(`UPDATE candidatos SET estado='contratado', wave_id=$1 WHERE cedula=$2 AND equipo=$3 AND estado <> 'contratado'`, [L.waveId, a.cedula, L.equipo]);
    }
    await c.query(`DELETE FROM libro_previews WHERE id = $1`, [p.id]);
  });
  const toSend = L.alerts.filter((a) => a.sev !== "info");
  await alerts.registrar(
    toSend.length ? toSend : [{ tipo: "wave_cerrada", sev: "info", titulo: "Wave cerrada sin alertas", msg: `${L.asesores.length} asesores pasan a Sala.`, equipo: L.equipo, wave: L.wave }],
    `Libro de ingresos ${L.equipo} Wave ${L.wave} · ${L.asesores.length} contratados`, req.user.id
  );
  res.json({ ok: true, waveId: L.waveId, resumen });
}));

/* ---------- waves (Etapa 1 historial y Etapa 2 Sala) ---------- */
app.get("/api/waves", need(), wrap(async (req, res) => {
  const w = await q(
    `SELECT w.*, u.nombre AS cerrada_por_nombre FROM waves w LEFT JOIN usuarios u ON u.id = w.cerrada_por
     WHERE w.equipo = ANY($1) ORDER BY w.cerrada_en DESC LIMIT 200`, [teamsOf(req.user)]);
  const ids = w.rows.map((x) => x.id);
  const a = ids.length ? (await q(`SELECT * FROM wave_asesores WHERE wave_id = ANY($1) ORDER BY nombre`, [ids])).rows : [];
  res.json(w.rows.map((x) => ({ ...x, asesores: a.filter((y) => y.wave_id === x.id) })));
}));
app.post("/api/waves/:id/reabrir", need("admin"), wrap(async (req, res) => {
  await q(`UPDATE waves SET estado='reabierta' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- alertas ---------- */
app.get("/api/alertas", need("admin", "reclutador", "aprobador"), wrap(async (req, res) => {
  const teams = req.query.equipo ? [req.query.equipo].filter((e) => teamsOf(req.user).includes(e)) : teamsOf(req.user);
  const r = await q(`SELECT * FROM alertas WHERE equipo = ANY($1) AND etapa = 1 ORDER BY creado_en DESC LIMIT 400`, [teams]);
  res.json(r.rows);
}));
app.post("/api/alertas/:id/revisada", need("admin", "reclutador", "aprobador"), wrap(async (req, res) => {
  const a = (await q(`SELECT * FROM alertas WHERE id=$1`, [req.params.id])).rows[0];
  if (!a) throw fail(404, "No existe esa alerta.");
  assertTeam(req.user, a.equipo);
  await q(`UPDATE alertas SET revisada=TRUE, revisada_por=$1 WHERE id=$2`, [req.user.id, a.id]);
  res.json({ ok: true });
}));
app.post("/api/alertas/:id/reenviar", need("admin", "reclutador"), wrap(async (req, res) => {
  const a = (await q(`SELECT * FROM alertas WHERE id=$1`, [req.params.id])).rows[0];
  if (!a) throw fail(404, "No existe esa alerta.");
  assertTeam(req.user, a.equipo);
  const r = await alerts.enviar(a.equipo, [{ ...a, msg: a.mensaje }], `Reenvío · ${a.titulo}`);
  await q(`UPDATE alertas SET envio_slack=$1, envio_correo=$2 WHERE id=$3`, [r.slack, r.correo, a.id]);
  res.json(r);
}));

/* ---------- administración ---------- */
app.get("/api/admin/usuarios", need("admin"), wrap(async (_req, res) => {
  res.json((await q(`SELECT id,email,nombre,rol,equipos,activo,ultimo_acceso FROM usuarios ORDER BY (rol IS NULL) DESC, nombre`)).rows);
}));
app.post("/api/admin/usuarios", need("admin"), wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email.endsWith("@" + DOMAIN)) throw fail(400, `El correo debe ser @${DOMAIN}.`);
  await q(`INSERT INTO usuarios (email) VALUES ($1) ON CONFLICT DO NOTHING`, [email]);
  res.json({ ok: true });
}));
app.put("/api/admin/usuarios/:id", need("admin"), wrap(async (req, res) => {
  const rol = req.body.rol || null;
  if (rol && !ROLES[rol]) throw fail(400, "Rol no válido.");
  const equipos = (req.body.equipos || []).filter((e) => EQUIPOS.includes(e));
  if (rol && rol !== "admin" && !equipos.length) throw fail(400, "Asigna al menos un equipo.");
  if (Number(req.params.id) === req.user.id && rol !== "admin") throw fail(400, "No puedes quitarte el rol de Administración.");
  await q(`UPDATE usuarios SET rol=$1, equipos=$2, activo=$3 WHERE id=$4`, [rol, equipos, req.body.activo !== false, req.params.id]);
  res.json({ ok: true });
}));
app.get("/api/admin/perfiles", need("admin"), wrap(async (_req, res) => res.json((await q(`SELECT * FROM perfiles`)).rows)));
app.put("/api/admin/perfiles/:equipo", need("admin"), wrap(async (req, res) => {
  const eq = req.params.equipo;
  if (!EQUIPOS.includes(eq)) throw fail(400, "Equipo no válido.");
  const clean = (a) => (a || []).map((s) => String(s).trim()).filter(Boolean);
  const must = clean(req.body.must);
  if (!must.length) throw fail(400, "El perfil necesita al menos un requisito obligatorio.");
  await q(
    `INSERT INTO perfiles (equipo,must,evaluar,no_pedir,consistencia_meses,actualizado_por,actualizado_en) VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (equipo) DO UPDATE SET must=$2, evaluar=$3, no_pedir=$4, consistencia_meses=$5, actualizado_por=$6, actualizado_en=now()`,
    [eq, must, clean(req.body.evaluar), clean(req.body.no_pedir), parseInt(req.body.consistencia_meses, 10) || 12, req.user.id]
  );
  res.json({ ok: true });
}));
app.get("/api/admin/destinos", need("admin"), wrap(async (_req, res) => res.json({ destinos: (await q(`SELECT * FROM destinos`)).rows, smtp: !!process.env.SMTP_HOST })));
app.put("/api/admin/destinos/:equipo", need("admin"), wrap(async (req, res) => {
  const eq = req.params.equipo;
  if (eq !== "*" && !EQUIPOS.includes(eq)) throw fail(400, "Equipo no válido.");
  const hook = String(req.body.slack_webhook || "").trim();
  if (hook && !/^https:\/\/hooks\.slack\.com\//.test(hook)) throw fail(400, "El webhook de Slack debe empezar por https://hooks.slack.com/");
  const emails = (req.body.emails || []).map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  await q(`INSERT INTO destinos (equipo,slack_webhook,emails) VALUES ($1,$2,$3) ON CONFLICT (equipo) DO UPDATE SET slack_webhook=$2, emails=$3`, [eq, hook, emails]);
  res.json({ ok: true });
}));
app.post("/api/admin/destinos/:equipo/probar", need("admin"), wrap(async (req, res) => {
  res.json(await alerts.enviar(req.params.equipo === "*" ? "General" : req.params.equipo, [{ sev: "info", titulo: "Prueba de alertas", msg: `Enviada por ${req.user.nombre || req.user.email}.`, equipo: req.params.equipo }], "Prueba de destino"));
}));
app.get("/api/admin/referencias", need("admin"), wrap(async (_req, res) => {
  const meta = (await q(`SELECT m.*, u.nombre FROM ref_meta m LEFT JOIN usuarios u ON u.id = m.actualizado_por`)).rows;
  res.json({ meta, waves: Number((await q(`SELECT count(*) FROM waves`)).rows[0].count) });
}));
app.post("/api/admin/hc", need("admin"), upload.single("archivo"), wrap(async (req, res) => {
  if (!req.file) throw fail(400, "Adjunta el HC Master (.xlsx).");
  const rows = R.parseHC(R.XLSX.read(req.file.buffer, { type: "buffer" }));
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
    await c.query(`INSERT INTO ref_meta (clave,total,actualizado_por,actualizado_en) VALUES ('hc',$1,$2,now()) ON CONFLICT (clave) DO UPDATE SET total=$1, actualizado_por=$2, actualizado_en=now()`, [rows.length, req.user.id]);
  });
  res.json({ total: rows.length });
}));
app.post("/api/admin/no-graduados", need("admin"), upload.single("archivo"), wrap(async (req, res) => {
  if (!req.file) throw fail(400, "Adjunta la lista de no graduados (.xlsx o .csv).");
  const rows = R.parseNoGraduados(R.XLSX.read(req.file.buffer, { type: "buffer" }));
  await tx(async (c) => {
    await c.query(`TRUNCATE no_graduados`);
    for (const r of rows)
      await c.query(`INSERT INTO no_graduados (cedula,nombre,equipo,wave,resultado,fecha_inicio,estado_caso) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.cedula, r.nombre, r.equipo, r.wave, r.resultado, r.fecha_inicio, r.estado_caso]);
    await c.query(`INSERT INTO ref_meta (clave,total,actualizado_por,actualizado_en) VALUES ('no_graduados',$1,$2,now()) ON CONFLICT (clave) DO UPDATE SET total=$1, actualizado_por=$2, actualizado_en=now()`, [rows.length, req.user.id]);
  });
  res.json({ total: rows.length });
}));

/* ---------- estáticos y errores ---------- */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html" }));
app.get(/^\/(?!api|auth).*/, (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  if (status >= 500) console.error(err);
  const msg = err.code === "LIMIT_FILE_SIZE" ? "El archivo supera 15 MB." : status >= 500 && !err.expose && !err.status ? "Error interno. Revisa los logs de Railway." : err.message;
  res.status(status).json({ error: msg });
});

const PORT = process.env.PORT || 3000;
migrate()
  .then(() => app.listen(PORT, () => console.log(`Ruta del Asesor escuchando en :${PORT}`)))
  .catch((e) => { console.error("Error migrando la base:", e); process.exit(1); });

module.exports = app;
