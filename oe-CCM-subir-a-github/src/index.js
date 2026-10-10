// Punto de entrada. Revisa la configuración antes de arrancar: si falta algo, en vez de caerse
// (Railway lo muestra como "Crashed" sin explicación) levanta una página que dice qué corregir.
const http = require("http");
const PORT = process.env.PORT || 3000;

const REQUIRED = [
  ["DATABASE_URL", "Agrega un servicio PostgreSQL al proyecto y, en las Variables de esta app, crea DATABASE_URL como referencia a la del Postgres: ${{Postgres.DATABASE_URL}}"],
  ["SESSION_SECRET", "Una frase larga y aleatoria (32 caracteres o más)."],
  ["GOOGLE_CLIENT_ID", "El ID de cliente OAuth de Google (termina en .apps.googleusercontent.com)."],
  ["ADMIN_EMAILS", "Tu correo @openenglish.com, para entrar como Administración."],
  ["ANTHROPIC_API_KEY", "La API key de Anthropic para el screening con IA."],
];

function diagnostic(problems) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ruta del Asesor · configuración pendiente</title>
<style>body{font-family:system-ui,sans-serif;background:#F4F6FA;color:#0B1033;margin:0;padding:40px 16px}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #D6DCE6;border-radius:12px;padding:28px}
h1{font-size:22px;margin:0 0 6px}p{color:#4A5270;margin:0 0 18px}li{margin-bottom:14px}code{background:#EAEFF7;padding:2px 6px;border-radius:5px;font-size:13px}.err{background:#FDE8EE;color:#D1123F;padding:10px 12px;border-radius:8px;font-family:monospace;font-size:13px;white-space:pre-wrap}</style></head>
<body><main><h1>Ruta del Asesor: falta configuración</h1><p>La app está desplegada, pero no puede arrancar hasta corregir esto en Railway → servicio → <b>Variables</b>. Después de guardar, Railway vuelve a desplegar solo.</p>
<ul>${problems.map(([k, v]) => `<li><code>${esc(k)}</code><br>${esc(v)}</li>`).join("")}</ul></main></body></html>`;
  http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: false, pendiente: problems.map((p) => p[0]) })); }
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }).listen(PORT, () => console.error(`Configuración pendiente (${problems.map((p) => p[0]).join(", ")}). Página de diagnóstico en :${PORT}`));
}

async function main() {
  const req = process.env.NODE_ENV === "production" ? REQUIRED : REQUIRED.slice(0, 1); // en desarrollo basta la base
  const missing = req.filter(([k]) => !String(process.env[k] || "").trim());
  if (missing.length) return diagnostic(missing);

  const { app, migrate } = require("./server");
  let lastErr;
  for (let i = 1; i <= 5; i++) {
    try { await migrate(); lastErr = null; break; }
    catch (e) { lastErr = e; console.error(`No se pudo preparar la base (intento ${i}/5): ${e.message}`); await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
  if (lastErr) {
    const hint = /ENOTFOUND|EAI_AGAIN/.test(lastErr.message) ? "El host de la base no existe. Verifica que DATABASE_URL apunte al Postgres de ESTE proyecto de Railway."
      : /password|authentication/i.test(lastErr.message) ? "Usuario o contraseña de la base incorrectos. Vuelve a crear la referencia ${{Postgres.DATABASE_URL}}."
      : /SSL|ssl/.test(lastErr.message) ? "La base pide SSL. Agrega la variable PGSSL=1."
      : "Revisa que el Postgres esté encendido y que DATABASE_URL sea la referencia correcta.";
    return diagnostic([["DATABASE_URL", `${hint}\nError: ${lastErr.message}`]]);
  }
  app.listen(PORT, () => console.log(`Ruta del Asesor escuchando en :${PORT}`));
}

process.on("unhandledRejection", (e) => console.error("Error no controlado:", e));
main().catch((e) => { console.error(e); diagnostic([["Arranque", e.message]]); });
