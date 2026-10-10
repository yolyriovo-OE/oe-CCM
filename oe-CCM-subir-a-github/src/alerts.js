// Registro y envío de alertas. Cada equipo puede tener su propio canal de Slack y correos;
// si no tiene, se usa el destino general ('*').
const nodemailer = require("nodemailer");
const { q } = require("./db");

let transport = null;
function mailer() {
  if (!process.env.SMTP_HOST) return null;
  return (transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  }));
}

async function destinoDe(equipo) {
  const r = await q(`SELECT * FROM destinos WHERE equipo = ANY($1)`, [[equipo, "*"]]);
  const team = r.rows.find((x) => x.equipo === equipo);
  const gen = r.rows.find((x) => x.equipo === "*") || { slack_webhook: "", emails: [] };
  return {
    slack: team?.slack_webhook || gen.slack_webhook || "",
    emails: [...new Set([...(team?.emails || []), ...(gen.emails || [])])],
  };
}

const ICON = { crit: ":red_circle:", media: ":large_orange_circle:", info: ":large_blue_circle:" };
const SEV = { crit: "CRÍTICA", media: "MEDIA", info: "INFO" };
const linea = (a) => `${a.nombre || ""}${a.cedula ? ` · ${a.cedula}` : ""} · ${a.equipo}${a.wave ? ` · Wave ${a.wave}` : ""}`;

async function enviar(equipo, list, asunto) {
  const d = await destinoDe(equipo);
  const res = { slack: "sin_destino", correo: "sin_destino" };
  const appUrl = process.env.APP_URL || "";
  if (d.slack) {
    try {
      const text = `*Ruta del Asesor · ${equipo}* — ${asunto}\n\n${list.map((a) => `${ICON[a.sev] || "•"} *${a.titulo}* — ${linea(a)}\n      ${a.msg}`).join("\n")}${appUrl ? `\n\n<${appUrl}|Abrir la Ruta del Asesor>` : ""}`;
      const r = await fetch(d.slack, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      res.slack = r.ok ? "enviado" : "error";
    } catch { res.slack = "error"; }
  }
  const m = mailer();
  if (d.emails.length && m) {
    try {
      await m.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: d.emails.join(", "),
        subject: `[Ruta del Asesor · ${equipo}] ${asunto}`,
        text: `Alertas de reclutamiento · ${equipo}\n\n${list.map((a) => `[${SEV[a.sev]}] ${a.titulo}\n${linea(a)}\n${a.msg}`).join("\n\n")}${appUrl ? `\n\nAbrir la app: ${appUrl}` : ""}`,
      });
      res.correo = "enviado";
    } catch (e) { console.error("SMTP", e.message); res.correo = "error"; }
  } else if (d.emails.length) res.correo = "sin_smtp";
  return res;
}

// Guarda y envía, agrupando por equipo
async function registrar(list, asunto, usuarioId) {
  if (!list.length) return [];
  const porEquipo = new Map();
  list.forEach((a) => porEquipo.set(a.equipo, [...(porEquipo.get(a.equipo) || []), a]));
  const ids = [];
  for (const [equipo, items] of porEquipo) {
    const envio = await enviar(equipo, items, asunto);
    for (const a of items) {
      const r = await q(
        `INSERT INTO alertas (etapa,tipo,sev,titulo,mensaje,cedula,nombre,equipo,wave,candidato_id,envio_slack,envio_correo,creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [a.etapa || 1, a.tipo, a.sev, a.titulo, a.msg || "", a.cedula || "", a.nombre || "", equipo, a.wave || "", a.candidatoId || null, envio.slack, envio.correo, usuarioId]
      );
      ids.push(r.rows[0].id);
    }
  }
  return ids;
}

module.exports = { registrar, enviar, destinoDe };
