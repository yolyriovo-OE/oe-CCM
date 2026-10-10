"use strict";
/* Ruta del Asesor · interfaz. Todo lo que ve cada persona está filtrado por los equipos que tiene asignados. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }); };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 4200); }

async function api(path, { method = "GET", body, form } = {}) {
  const opt = { method, headers: {} };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/api/me") { S.user = null; render(); }
  if (!r.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data;
}

const S = {
  user: null, cfg: null, stage: "1", tab: "screening", equipo: "", // equipo = filtro activo ("" = todos mis equipos)
  perfiles: {}, candidatos: [], alertas: [], desbloqueos: [], waves: [],
  draft: null, result: null, libro: null, busy: false, confirmClose: false, estadoFiltro: "",
  admin: { usuarios: [], perfiles: [], destinos: [], smtp: false, refs: null, pfEq: "Adultos", dEq: "*" },
};
const ROLE = () => S.user?.rol;
const can = {
  etapa1: () => ["admin", "reclutador"].includes(ROLE()),
  desbloquear: () => ["admin", "aprobador"].includes(ROLE()),
  verDesbloqueos: () => ["admin", "reclutador", "aprobador"].includes(ROLE()),
  config: () => ROLE() === "admin",
};
const myTeams = () => S.user?.equipos || [];
const inFilter = (eq) => !S.equipo || eq === S.equipo;

/* ---------- Arranque y sesión ---------- */
$$(".stage").forEach((b) => b.addEventListener("click", () => { if (b.disabled) return; S.stage = b.dataset.stage; syncRail(); render(); }));
function syncRail() { $$(".stage").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.stage === S.stage))); }

(async function boot() {
  try { const r = await api("/api/me"); S.user = r.user; S.cfg = r.config; } catch { S.cfg = null; }
  if (S.user?.rol) await loadAll();
  render();
})();

async function loadAll() {
  const jobs = [api("/api/perfiles").then((r) => { S.perfiles = Object.fromEntries(r.map((p) => [p.equipo, p])); }), api("/api/waves").then((r) => (S.waves = r))];
  if (can.etapa1()) jobs.push(loadCandidatos(), api("/api/alertas").then((r) => (S.alertas = r)));
  if (can.verDesbloqueos()) jobs.push(api("/api/desbloqueos").then((r) => (S.desbloqueos = r)));
  await Promise.all(jobs.map((j) => j.catch((e) => toast(e.message))));
  if (myTeams().length === 1) S.equipo = myTeams()[0];
}
const loadCandidatos = () => api("/api/candidatos").then((r) => (S.candidatos = r));

function loginHTML() {
  const c = S.cfg || {};
  return `<div class="login">
    <picture class="oe-logo big"><source srcset="/logo-openenglish-dark.png" media="(prefers-color-scheme: dark)"><img src="/logo-openenglish.png" alt="Open English" width="220" height="84"></picture>
    <h1>Ruta del Asesor</h1>
    <p class="muted">Training administrativo de Open English. Entra con tu cuenta @${esc(c.dominio || "openenglish.com")}.</p>
    ${c.googleClientId ? `<div id="gbtn"></div>` : `<div class="banner warn"><span>Falta configurar GOOGLE_CLIENT_ID en Railway.</span></div>`}
    ${c.devLogin ? `<div class="panel stack" style="width:100%;text-align:left"><p class="eyebrow">Modo desarrollo</p><input type="email" id="dev-email" placeholder="correo@${esc(c.dominio)}"><button class="btn" id="dev-go">Entrar sin Google</button></div>` : ""}
  </div>`;
}
function bindLogin() {
  const c = S.cfg || {};
  const tryGoogle = () => {
    if (!window.google?.accounts?.id) return setTimeout(tryGoogle, 200);
    google.accounts.id.initialize({ client_id: c.googleClientId, hd: c.dominio, callback: async ({ credential }) => {
      try { const r = await api("/auth/google", { method: "POST", body: { credential } }); S.user = r.user; if (S.user.rol) await loadAll(); render(); } catch (e) { toast(e.message); }
    } });
    const el = $("#gbtn"); if (el) google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", locale: "es" });
  };
  if (c.googleClientId) tryGoogle();
  $("#dev-go")?.addEventListener("click", async () => { try { const r = await api("/auth/dev", { method: "POST", body: { email: $("#dev-email").value } }); S.user = r.user; if (S.user.rol) await loadAll(); render(); } catch (e) { toast(e.message); } });
}

/* ---------- Render principal ---------- */
function render() {
  const logged = !!S.user;
  $("#top").hidden = !logged; $("#rail").hidden = !logged || !S.user.rol;
  const m = $("#main");
  if (!S.cfg) { m.innerHTML = lockHTML("No hay conexión con el servidor", "Revisa que el servicio esté desplegado en Railway y vuelve a cargar."); return; }
  if (!logged) { m.innerHTML = loginHTML(); bindLogin(); return; }
  const u = S.user;
  $("#who").innerHTML = `<span class="userchip">${u.foto ? `<img src="${esc(u.foto)}" alt="">` : ""}<span>${esc(u.nombre || u.email)}</span></span><span class="role">${esc(u.rol ? S.cfg.roles[u.rol] : "Pendiente")}</span>${can.config() ? `<button class="iconbtn" id="btn-config" aria-pressed="${S.stage === "cfg"}">Configuración</button>` : ""}<button class="iconbtn" id="btn-out">Salir</button>`;
  $("#btn-out").onclick = async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); S.user = null; render(); };
  $("#btn-config")?.addEventListener("click", async () => { S.stage = S.stage === "cfg" ? "1" : "cfg"; syncRail(); if (S.stage === "cfg") await loadAdmin(); render(); });
  if (!u.rol) { m.innerHTML = lockHTML("Tu usuario está pendiente de rol", "Administración debe asignarte un rol y tus equipos. Cuando lo haga, vuelve a cargar la página."); return; }
  const sala = S.waves.filter((w) => w.estado === "sala").length;
  $("#st2-sub").textContent = sala ? `${sala} wave${sala > 1 ? "s" : ""} en sala` : "Asistencia, disciplinarios, exámenes";
  if (S.stage === "cfg" && can.config()) { m.innerHTML = cfgHTML(); bindCfg(); return; }
  if (S.stage === "2") { m.innerHTML = teamBarHTML() + etapa2HTML(); bindTeamBar(); return; }
  if (!can.etapa1() && !can.verDesbloqueos()) { m.innerHTML = lockHTML("La Etapa 1 es solo para Reclutamiento", "Cuando el reclutador sube el libro de ingresos, la wave se cierra y aparece en Etapa 2 · Sala."); return; }
  if (!can.etapa1()) S.tab = "desbloqueos";
  m.innerHTML = teamBarHTML() + etapa1HTML(); bindTeamBar(); bindEtapa1();
}
function lockHTML(t, d) { return `<div class="panel lock"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="1.6"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><div class="stack" style="gap:6px"><h2>${esc(t)}</h2><p class="muted">${esc(d)}</p></div></div>`; }

function teamBarHTML() {
  const T = myTeams();
  if (T.length <= 1) return `<div class="row" style="margin-bottom:14px"><span class="eyebrow">Equipo</span><span class="pill p-info">${esc(T[0] || "Sin equipo")}</span></div>`;
  return `<div class="row" style="margin-bottom:14px"><label class="eyebrow" for="team-filter">Equipo</label><select id="team-filter" style="width:auto"><option value="">Todos mis equipos (${T.length})</option>${T.map((e) => `<option ${e === S.equipo ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></div>`;
}
function bindTeamBar() { $("#team-filter")?.addEventListener("change", (e) => { S.equipo = e.target.value; if (S.draft && S.equipo) S.draft.equipo = S.equipo; render(); }); }

/* ---------- Etapa 1 ---------- */
function etapa1HTML() {
  const pend = S.desbloqueos.filter((d) => d.estado === "pendiente" && inFilter(d.equipo)).length;
  const crit = S.alertas.filter((a) => a.sev === "crit" && !a.revisada && inFilter(a.equipo)).length;
  const nc = S.candidatos.filter((c) => inFilter(c.equipo)).length;
  const T = [["screening", "Screening de hoja de vida"], ["candidatos", "Candidatos", nc], ["libro", "Libro de ingresos"], ["alertas", "Alertas", crit, "crit"], ["desbloqueos", "Desbloqueos", pend, pend ? "crit" : ""]]
    .filter((t) => can.etapa1() || t[0] === "desbloqueos");
  const body = { screening: screeningHTML, candidatos: candidatosHTML, libro: libroHTML, alertas: alertasHTML, desbloqueos: desbloqueosHTML }[S.tab]();
  return `<div class="tabs" role="tablist">${T.map((t) => `<button class="tab" role="tab" data-tab="${t[0]}" aria-selected="${S.tab === t[0]}">${t[1]}${t[2] ? `<span class="count ${t[3] || ""}">${t[2]}</span>` : ""}</button>`).join("")}</div>${body}`;
}
function bindEtapa1() {
  $$(".tab").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; render(); }));
  ({ screening: bindScreening, candidatos: bindCandidatos, libro: bindLibro, alertas: bindAlertas, desbloqueos: bindDesbloqueos }[S.tab])();
}

/* --- Screening --- */
const REC = { avanza: ["ok", "Avanza a entrevista"], avanza_con_dudas: ["warn", "Avanza con dudas"], no_cumple_must: ["crit", "No cumple el must"] };
const estadoTxt = (e) => ({ screening: "Screening hecho", entrevista: "Pasa a entrevista", espera: "En espera", descartado: "Descartado", bloqueado: "Bloqueado", contratado: "Contratado" }[e] || e || "");
function screeningHTML() {
  const T = myTeams();
  const d = S.draft || (S.draft = { equipo: S.equipo || (T.length === 1 ? T[0] : ""), cedula: "", nombre: "", fuente: "Computrabajo", link: "", modo: "archivo", texto: "", archivo: null });
  const p = d.equipo ? S.perfiles[d.equipo] : null;
  return `<div class="grid2">
  <section class="panel stack" aria-labelledby="h-nuevo">
    <div><p class="eyebrow">Paso 1 de 3 · el reclutador monta la información</p><h2 id="h-nuevo">Nuevo candidato</h2></div>
    <div class="row">
      <div class="field"><label for="f-eq">Equipo al que aplica</label><select id="f-eq"><option value="" ${d.equipo ? "" : "selected"} disabled>Selecciona el equipo</option>${T.map((e) => `<option ${e === d.equipo ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></div>
      <div class="field"><label for="f-fuente">Fuente</label><select id="f-fuente">${S.cfg.fuentes.map((e) => `<option ${e === d.fuente ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></div>
    </div>
    ${d.equipo && !p ? `<div class="banner crit"><span>El perfil de <b>${esc(d.equipo)}</b> no está cargado. No se puede hacer screening para este equipo hasta que Administración lo cargue.</span></div>` : ""}
    ${p ? `<details><summary class="small">Perfil exigido de ${esc(d.equipo)} (${p.must.length} obligatorios)</summary><ul class="small muted" style="margin:8px 0 0;padding-left:18px">${p.must.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>` : ""}
    <div class="row">
      <div class="field"><label for="f-cc">Cédula / CPF</label><input type="text" id="f-cc" inputmode="numeric" class="mono" value="${esc(d.cedula)}" placeholder="Obligatoria"></div>
      <div class="field"><label for="f-nom">Nombre</label><input type="text" id="f-nom" value="${esc(d.nombre)}" placeholder="Si lo dejas vacío, se toma de la hoja de vida"></div>
    </div>
    <div class="field"><label for="f-link">Link de la hoja de vida o del perfil (opcional)</label><input type="text" id="f-link" value="${esc(d.link)}" placeholder="LinkedIn, Computrabajo, Drive…"></div>
    <div class="stack" style="gap:8px">
      <div class="row" style="justify-content:space-between"><span class="field" style="flex:none"><label>Hoja de vida</label></span>
        <div class="seg" role="group" aria-label="Cómo cargar la hoja de vida"><button data-modo="archivo" aria-pressed="${d.modo === "archivo"}">Archivo</button><button data-modo="texto" aria-pressed="${d.modo === "texto"}">Pegar texto</button></div></div>
      ${d.modo === "archivo" ? `<label class="drop" id="drop" for="f-file"><strong>${d.archivo ? esc(d.archivo.name) : "Arrastra la hoja de vida o haz clic"}</strong><span class="hint">${d.archivo ? `${Math.round(d.archivo.size / 1024)} KB · lista para analizar` : "PDF, Word (.docx), JPG o PNG. Para LinkedIn: en el perfil, Más → Guardar en PDF."}</span></label>
        <input type="file" id="f-file" hidden accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png">`
      : `<textarea id="f-texto" placeholder="Pega el texto de la hoja de vida o del perfil de LinkedIn / portal">${esc(d.texto)}</textarea>`}
    </div>
    <div class="row" style="justify-content:space-between">
      <span class="hint">La IA evalúa solo contra el perfil del equipo elegido y no considera edad, género, hijos, estado civil, foto ni dirección.</span>
      <button class="btn" id="btn-analizar" ${S.busy || !p ? "disabled" : ""}>${S.busy ? `<span class="spinner"></span> Analizando…` : "Analizar hoja de vida"}</button>
    </div>
  </section>
  <section aria-live="polite">${S.result ? resultHTML(S.result) : `<div class="empty"><p class="eyebrow">Paso 2 de 3 · la IA analiza y alerta</p><h3>El resultado del screening aparece aquí</h3><p>Primero se revisan bloqueos, reintegros y cédulas duplicadas. Si la cédula está bloqueada, la IA no corre. Luego cada requisito del perfil del equipo sale con la evidencia de la hoja de vida y las preguntas para la entrevista.</p></div>`}</section>
  </div>`;
}
function bindScreening() {
  const d = S.draft;
  const bind = (id, k) => $(id)?.addEventListener("input", (e) => (d[k] = e.target.value));
  $("#f-eq").addEventListener("change", (e) => { d.equipo = e.target.value; render(); });
  $("#f-fuente").addEventListener("change", (e) => (d.fuente = e.target.value));
  bind("#f-cc", "cedula"); bind("#f-nom", "nombre"); bind("#f-link", "link"); bind("#f-texto", "texto");
  $$("[data-modo]").forEach((b) => b.addEventListener("click", () => { d.modo = b.dataset.modo; render(); }));
  const f = $("#f-file"), dr = $("#drop");
  if (f) {
    f.addEventListener("change", () => { d.archivo = f.files[0] || null; render(); });
    dr.addEventListener("dragover", (e) => { e.preventDefault(); dr.classList.add("over"); });
    dr.addEventListener("dragleave", () => dr.classList.remove("over"));
    dr.addEventListener("drop", (e) => { e.preventDefault(); dr.classList.remove("over"); d.archivo = e.dataTransfer.files[0] || null; render(); });
  }
  $("#btn-analizar").addEventListener("click", analizar);
  bindResult();
}
async function analizar() {
  const d = S.draft;
  if (!d.equipo) return toast("Selecciona el equipo al que aplica el candidato.");
  if (d.cedula.replace(/\D/g, "").length < 6) return toast("Escribe la cédula o CPF (solo números).");
  if (d.modo === "archivo" && !d.archivo) return toast("Adjunta la hoja de vida.");
  if (d.modo === "texto" && d.texto.trim().length < 80) return toast("Pega el texto completo de la hoja de vida.");
  const fd = new FormData();
  ["equipo", "cedula", "nombre", "fuente", "link"].forEach((k) => fd.append(k, d[k] || ""));
  if (d.modo === "archivo") fd.append("archivo", d.archivo); else fd.append("texto", d.texto);
  S.busy = true; render();
  try {
    const c = await api("/api/screening", { method: "POST", form: fd });
    S.result = c; S.busy = false; await Promise.all([loadCandidatos(), api("/api/alertas").then((r) => (S.alertas = r))]); render();
  } catch (e) { S.busy = false; render(); toast(e.message); }
}
function alertRow(a) {
  const sev = a.sev === "crit" ? "crit" : a.sev === "media" ? "media" : "info";
  return `<div class="alert ${sev}"><span class="bar"></span><div><b>${esc(a.titulo)}</b><p>${esc(a.msg ?? a.mensaje)}</p></div><span class="pill ${sev === "crit" ? "p-crit" : sev === "media" ? "p-warn" : "p-info"}">${sev === "crit" ? "Crítica" : sev === "media" ? "Media" : "Info"}</span></div>`;
}
function resultHTML(c) {
  const pre = c.pre || [];
  const preHTML = pre.length ? `<div class="alerts">${pre.map(alertRow).join("")}</div>` : `<div class="banner ok"><span><b>Sin bloqueos ni reintegros.</b> La cédula no aparece en el HC Master, en la lista de no graduados ni en waves anteriores.</span></div>`;
  const head = (pill) => `<div class="verdict"><div><p class="eyebrow">${esc(c.equipo)} · cédula <span class="mono">${esc(c.cedula)}</span> · ${esc(c.fuente)}</p><h2>${esc(c.nombre || "Candidato")}</h2>${c.screening?.razon ? `<p class="muted small" style="margin-top:4px">${esc(c.screening.razon)}</p>` : ""}</div>${pill}</div>`;
  if (c.estado === "bloqueado") return `<div class="panel stack">${head(`<span class="big crit">Bloqueado</span>`)}${preHTML}
    <p class="muted">La IA no analizó la hoja de vida: esta persona fue contratada antes y nunca se graduó. Para continuar, solicita un desbloqueo; queda registrado quién lo aprueba y por qué.</p>
    <div class="field"><label for="f-motivo-des">Motivo de la solicitud</label><textarea id="f-motivo-des" style="min-height:70px"></textarea></div>
    <div class="row"><button class="btn" id="btn-sol-des">Solicitar desbloqueo</button><button class="btn quiet" id="btn-nuevo">Nuevo candidato</button></div></div>`;
  const ia = c.screening || {};
  const rec = REC[c.recomendacion] || ["warn", "Revisar"];
  const jobs = (ia.empleos || []).slice(0, 8);
  const decided = ["entrevista", "espera", "descartado", "contratado"].includes(c.estado);
  return `<div class="panel stack">${head(`<span class="big ${rec[0]}">${rec[1]}</span>`)}${preHTML}
    <div><h3 style="margin-bottom:4px">Requisitos obligatorios de ${esc(c.equipo)}</h3><div class="checks">${(ia.must || []).map((m) => `<div class="check"><span class="ic ${esc(m.estado)}">${m.estado === "cumple" ? "✓" : m.estado === "no_cumple" ? "✕" : "?"}</span><div><div>${esc(m.criterio)}</div>${m.evidencia ? `<div class="quote">${esc(m.evidencia)}</div>` : ""}</div><span class="pill ${m.estado === "cumple" ? "p-ok" : m.estado === "no_cumple" ? "p-crit" : "p-warn"}">${{ cumple: "Cumple", no_cumple: "No cumple", no_evidencia: "No se evidencia", verificar: "Verificar" }[m.estado] || esc(m.estado)}</span></div>`).join("")}</div></div>
    <div class="kv"><div><b>${ia.experiencia_ventas_meses ?? "—"}</b><span>meses en ventas</span></div><div><b>${ia.consistencia?.max_meses_un_empleo ?? "—"}</b><span>máx. meses en un empleo</span></div><div><b>${ia.consistencia?.empleos_ultimos_3_anios ?? "—"}</b><span>empleos en 3 años</span></div></div>
    ${ia.consistencia?.lectura ? `<p class="muted small">${esc(ia.consistencia.lectura)}</p>` : ""}
    ${jobs.length ? `<div style="overflow-x:auto"><table class="jobs"><thead><tr><th>Empresa</th><th>Cargo</th><th>Ventas</th><th style="text-align:right">Meses</th></tr></thead><tbody>${jobs.map((j) => `<tr><td>${esc(j.empresa)}</td><td>${esc(j.cargo)}</td><td>${j.ventas ? "Sí" : "No"}</td><td class="n">${j.meses ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${(ia.banderas || []).length ? `<div><h3 style="margin-bottom:6px">Banderas</h3><div class="alerts">${ia.banderas.map((b) => `<div class="alert media"><span class="bar"></span><div><b>${esc(b.tipo)}</b><p>${esc(b.detalle)}</p></div><span></span></div>`).join("")}</div></div>` : ""}
    ${(ia.fortalezas || []).filter(Boolean).length ? `<div><h3 style="margin-bottom:6px">Fortalezas</h3><div class="chips">${ia.fortalezas.filter(Boolean).map((f) => `<span class="chip">${esc(f)}</span>`).join("")}</div></div>` : ""}
    ${(ia.preguntas || []).length ? `<div><h3 style="margin-bottom:6px">Preguntas sugeridas para la entrevista</h3><ol class="qlist">${ia.preguntas.map((q) => `<li><em>${esc(q.bloque)}</em>${esc(q.pregunta)}</li>`).join("")}</ol></div>` : ""}
    <div><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3>Resumen para el libro de ingresos</h3><button class="btn quiet" id="btn-copy" style="padding:5px 10px">Copiar</button></div><div class="summary" id="resumen-txt">${esc(ia.resumen || "")}</div></div>
    <div class="sep"></div>
    <div><p class="eyebrow">Paso 3 de 3 · decisión del reclutador</p>
    ${c.estado === "contratado" ? `<p class="small" style="margin-top:8px">Contratado en ${esc(c.wave_id || "")}.</p>` : `
    <div class="field" style="margin-top:8px"><label for="f-coment">Comentario (queda en el registro)</label><textarea id="f-coment" style="min-height:60px">${esc(c.comentario || "")}</textarea></div>
    <div class="row" style="margin-top:10px"><button class="btn" data-dec="entrevista">Pasa a entrevista</button><button class="btn ghost" data-dec="espera">En espera</button><button class="btn quiet" data-dec="descartado">Descartar</button><button class="btn quiet" id="btn-nuevo">Nuevo candidato</button></div>
    ${decided ? `<p class="hint" style="margin-top:8px">Decisión actual: ${esc(estadoTxt(c.estado))}.</p>` : ""}`}</div>
  </div>`;
}
function bindResult() {
  $("#btn-nuevo")?.addEventListener("click", () => { S.result = null; S.draft = null; render(); });
  $("#btn-copy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#resumen-txt").textContent); toast("Resumen copiado."); }
    catch { const r = document.createRange(); r.selectNodeContents($("#resumen-txt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Texto seleccionado: cópialo con Ctrl+C."); }
  });
  $$("[data-dec]").forEach((b) => b.addEventListener("click", async () => {
    try { S.result = await api(`/api/candidatos/${S.result.id}/decision`, { method: "POST", body: { estado: b.dataset.dec, comentario: $("#f-coment").value } }); await loadCandidatos(); toast("Decisión guardada."); render(); } catch (e) { toast(e.message); }
  }));
  $("#btn-sol-des")?.addEventListener("click", async () => {
    try { await api("/api/desbloqueos", { method: "POST", body: { candidatoId: S.result.id, motivo: $("#f-motivo-des").value } }); S.desbloqueos = await api("/api/desbloqueos"); toast("Solicitud enviada a los aprobadores."); S.result = null; S.draft = null; render(); } catch (e) { toast(e.message); }
  });
}

/* --- Candidatos --- */
function candidatosHTML() {
  const L = S.candidatos.filter((c) => inFilter(c.equipo) && (!S.estadoFiltro || c.estado === S.estadoFiltro));
  const recPill = (r) => r === "bloqueado" ? `<span class="pill p-crit">Bloqueado</span>` : REC[r] ? `<span class="pill ${REC[r][0] === "ok" ? "p-ok" : REC[r][0] === "warn" ? "p-warn" : "p-crit"}">${REC[r][1]}</span>` : "";
  return `<div class="stack">
  <div class="row"><div class="field" style="flex:0 1 220px"><label for="fl-st">Estado</label><select id="fl-st"><option value="">Todos</option>${["screening", "entrevista", "espera", "descartado", "bloqueado", "contratado"].map((e) => `<option value="${e}" ${e === S.estadoFiltro ? "selected" : ""}>${estadoTxt(e)}</option>`).join("")}</select></div>
  <span class="hint" style="align-self:flex-end;padding-bottom:9px">${L.length} candidato${L.length === 1 ? "" : "s"}${S.equipo ? ` de ${esc(S.equipo)}` : ""}</span></div>
  ${L.length ? `<div class="tablewrap"><table class="data"><thead><tr><th>Fecha</th><th>Candidato</th><th>Equipo</th><th>Screening IA</th><th>Estado</th><th>Alertas</th><th>Reclutador</th></tr></thead><tbody>
  ${L.map((c) => { const crit = (c.pre || []).filter((p) => p.sev === "crit").length; return `<tr class="clickable" data-cand="${c.id}" tabindex="0"><td class="mono small">${fmtDate(c.creado_en)}</td><td><b>${esc(c.nombre || "Sin nombre")}</b><div class="mono small muted">${esc(c.cedula)}</div></td><td>${esc(c.equipo)}</td><td>${recPill(c.recomendacion)}</td><td>${esc(estadoTxt(c.estado))}${c.wave_id ? `<div class="small muted">${esc(c.wave_id)}</div>` : ""}</td><td>${crit ? `<span class="count crit">${crit} crítica${crit > 1 ? "s" : ""}</span>` : `<span class="muted small">—</span>`}</td><td class="small">${esc(c.reclutador || "")}</td></tr>`; }).join("")}
  </tbody></table></div>` : `<div class="empty"><h3>Sin candidatos todavía</h3><p>Cada hoja de vida analizada en Screening queda registrada aquí con su resultado y la decisión del reclutador.</p></div>`}
  </div>`;
}
function bindCandidatos() {
  $("#fl-st").addEventListener("change", (e) => { S.estadoFiltro = e.target.value; render(); });
  $$("[data-cand]").forEach((tr) => {
    const open = async () => { try { const c = await api(`/api/candidatos/${tr.dataset.cand}`); S.result = c; S.draft = { equipo: c.equipo, cedula: c.cedula, nombre: c.nombre, fuente: c.fuente, link: c.link, modo: "archivo", texto: "", archivo: null }; S.tab = "screening"; render(); scrollTo({ top: 0 }); } catch (e) { toast(e.message); } };
    tr.addEventListener("click", open); tr.addEventListener("keydown", (e) => e.key === "Enter" && open());
  });
}

/* --- Alertas --- */
const ENV = { enviado: ["p-ok", "Enviado"], sin_destino: ["p-mute", "Sin destino"], sin_smtp: ["p-warn", "Falta SMTP"], error: ["p-crit", "Error"], pendiente: ["p-mute", "Pendiente"] };
const envPill = (v, lbl) => { const e = ENV[v] || ["p-mute", v]; return `<span class="pill ${e[0]}">${lbl}: ${e[1]}</span>`; };
function alertasHTML() {
  const L = S.alertas.filter((a) => inFilter(a.equipo));
  if (!L.length) return `<div class="empty"><h3>Sin alertas todavía</h3><p>Aquí aparecen las alertas del screening y del libro de ingresos de tus equipos, con su estado de envío por Slack y correo.</p></div>`;
  return `<div class="tablewrap"><table class="data"><thead><tr><th>Fecha</th><th>Alerta</th><th>Asesor</th><th>Equipo</th><th>Envío</th><th></th></tr></thead><tbody>
    ${L.map((a) => `<tr><td class="mono small">${fmtDate(a.creado_en)}</td><td><span class="pill ${a.sev === "crit" ? "p-crit" : a.sev === "media" ? "p-warn" : "p-info"}">${esc(a.titulo)}</span><div class="small muted" style="margin-top:4px">${esc(a.mensaje)}</div></td><td>${esc(a.nombre)}<div class="mono small muted">${esc(a.cedula)}</div></td><td>${esc(a.equipo)}${a.wave ? ` · W${esc(a.wave)}` : ""}</td><td><div class="stack" style="gap:4px">${envPill(a.envio_slack, "Slack")}${envPill(a.envio_correo, "Correo")}</div></td>
    <td><div class="stack" style="gap:4px">${a.revisada ? `<span class="pill p-ok">Revisada</span>` : `<button class="btn quiet" data-res="${a.id}" style="padding:4px 9px">Marcar revisada</button>`}${a.envio_slack !== "enviado" || a.envio_correo !== "enviado" ? `<button class="btn quiet" data-reenv="${a.id}" style="padding:4px 9px">Reenviar</button>` : ""}</div></td></tr>`).join("")}
    </tbody></table></div>`;
}
function bindAlertas() {
  $$("[data-res]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/api/alertas/${b.dataset.res}/revisada`, { method: "POST" }); S.alertas = await api("/api/alertas"); render(); } catch (e) { toast(e.message); } }));
  $$("[data-reenv]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { const r = await api(`/api/alertas/${b.dataset.reenv}/reenviar`, { method: "POST" }); S.alertas = await api("/api/alertas"); toast(r.slack === "enviado" || r.correo === "enviado" ? "Alerta reenviada." : "No se pudo reenviar: revisa los destinos del equipo."); render(); } catch (e) { toast(e.message); } }));
}

/* --- Desbloqueos --- */
function desbloqueosHTML() {
  const L = S.desbloqueos.filter((d) => inFilter(d.equipo));
  if (!L.length) return `<div class="empty"><h3>No hay solicitudes de desbloqueo</h3><p>Cuando una cédula sale bloqueada (contratada antes y no graduada), el reclutador puede pedir el desbloqueo con un motivo. ${can.desbloquear() ? "Tú decides si se aprueba." : "Lo aprueba un aprobador del equipo."}</p></div>`;
  return `<div class="stack">${L.map((d) => `<div class="panel stack" style="gap:10px">
    <div class="row" style="justify-content:space-between"><div><p class="eyebrow">${esc(d.equipo)} · <span class="mono">${esc(d.cedula)}</span></p><h3>${esc(d.nombre || "Sin nombre")}</h3></div>
    <span class="pill ${d.estado === "pendiente" ? "p-warn" : d.estado === "aprobado" ? "p-ok" : "p-crit"}">${{ pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado" }[d.estado]}</span></div>
    <p class="small"><b>Antecedente:</b> ${esc(d.antecedente)}</p>
    <p class="small"><b>Motivo de ${esc(d.solicitado_por_nombre || "")}:</b> ${esc(d.solicitud)} <span class="muted">· ${fmtDate(d.solicitado_en)}</span></p>
    ${d.estado !== "pendiente" ? `<p class="small muted">${d.estado === "aprobado" ? "Aprobado" : "Rechazado"} por ${esc(d.resuelto_por_nombre || "")} el ${fmtDate(d.resuelto_en)}: ${esc(d.comentario)}</p>`
      : can.desbloquear() ? `<div class="field"><label for="dc-${esc(d.cedula)}">Comentario de la decisión</label><input type="text" id="dc-${esc(d.cedula)}"></div><div class="row"><button class="btn" data-apr="${esc(d.cedula)}">Aprobar desbloqueo</button><button class="btn danger" data-rech="${esc(d.cedula)}">Rechazar</button></div>` : `<p class="hint">Esperando decisión de un aprobador.</p>`}
  </div>`).join("")}</div>`;
}
function bindDesbloqueos() {
  const act = async (ced, estado) => {
    try { await api(`/api/desbloqueos/${ced}/resolver`, { method: "POST", body: { estado, comentario: $("#dc-" + ced)?.value || "" } }); S.desbloqueos = await api("/api/desbloqueos"); if (can.etapa1()) await loadCandidatos(); toast(estado === "aprobado" ? "Desbloqueo aprobado." : "Desbloqueo rechazado."); render(); } catch (e) { toast(e.message); }
  };
  $$("[data-apr]").forEach((b) => b.addEventListener("click", () => act(b.dataset.apr, "aprobado")));
  $$("[data-rech]").forEach((b) => b.addEventListener("click", () => act(b.dataset.rech, "rechazado")));
}

/* --- Libro de ingresos --- */
function libroHTML() {
  const L = S.libro, T = myTeams();
  const eqSel = L?.equipo || S.equipo || (T.length === 1 ? T[0] : "");
  let out = `<section class="panel stack">
    <div><p class="eyebrow">Cierre de la Etapa 1</p><h2>Subir libro de ingresos</h2><p class="muted" style="margin-top:4px">Sube el libro con las personas contratadas. Se cruza contra bloqueos, reintegros y el screening <b>del mismo equipo</b>. Al cerrarlo, la wave pasa a Etapa 2 · Sala y queda cerrada para Reclutamiento.</p></div>
    <div class="row">
      <div class="field"><label for="lb-eq">Equipo</label><select id="lb-eq"><option value="" ${eqSel ? "" : "selected"} disabled>Selecciona el equipo</option>${T.map((e) => `<option ${e === eqSel ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></div>
      <div class="field" style="flex:0 1 140px"><label for="lb-w">Wave</label><input type="text" id="lb-w" inputmode="numeric" value="${esc(L?.wave || S._lbWave || "")}" placeholder="01"></div>
    </div>
    <label class="drop" id="lb-drop" for="lb-file"><strong>${L?.archivo ? esc(L.archivo) : S.busy ? "Procesando…" : "Arrastra el libro (.xlsx o .csv) o haz clic"}</strong><span class="hint">Desde Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx). Se usa la hoja "Libro de ingresos ESP" o "BR".</span></label>
    <input type="file" id="lb-file" hidden accept=".xlsx,.xls,.csv">
  </section>`;
  if (L) {
    const al = L.alerts, nCrit = al.filter((a) => a.sev === "crit").length, nMed = al.filter((a) => a.sev === "media").length;
    const bloq = al.filter((a) => a.tipo === "bloqueado");
    const by = new Map(); al.forEach((a) => { const k = a.cedula || a.nombre; by.set(k, [...(by.get(k) || []), a]); });
    out += `<section class="panel stack">
      <div class="verdict"><div><p class="eyebrow">Hoja "${esc(L.hoja)}" · ${esc(L.equipo)} · Wave ${esc(L.wave)}</p><h2>${L.asesores.length} contratados</h2></div>
      <div class="row">${nCrit ? `<span class="pill p-crit">${nCrit} críticas</span>` : ""}${nMed ? `<span class="pill p-warn">${nMed} medias</span>` : ""}${!nCrit && !nMed ? `<span class="pill p-ok">Sin alertas críticas</span>` : ""}</div></div>
      <div class="tablewrap"><table class="data"><thead><tr><th>Asesor</th><th>Inicio</th><th>Escolaridad</th><th>Meses últ. empresa</th><th>Alertas</th></tr></thead><tbody>
      ${L.asesores.map((a) => { const A = by.get(a.cedula || a.nombre) || []; return `<tr><td><b>${esc(a.nombre)}</b><div class="mono small muted">${esc(a.cedula || "sin cédula")}</div></td><td class="mono small">${esc(a.fecha)}</td><td class="small">${esc(a.educacion || "—")}</td><td class="mono">${esc(a.meses || "—")}</td><td>${A.length ? `<div class="stack" style="gap:4px">${A.map((x) => `<span class="pill ${x.sev === "crit" ? "p-crit" : x.sev === "media" ? "p-warn" : "p-info"}" title="${esc(x.msg)}">${esc(x.titulo)}</span>`).join("")}</div>` : `<span class="pill p-ok">OK</span>`}</td></tr>`; }).join("")}
      </tbody></table></div>
      ${bloq.length ? `<div class="banner crit"><span><b>${bloq.length} persona${bloq.length > 1 ? "s" : ""} bloqueada${bloq.length > 1 ? "s" : ""}.</b> No se puede cerrar la wave hasta que un aprobador desbloquee esas cédulas o las saques del libro.</span></div>` : ""}
      ${L.yaCerrada ? `<div class="banner warn"><span>${esc(L.equipo)} Wave ${esc(L.wave)} ya se cerró el ${fmtDate(L.yaCerrada)}. Solo Administración puede reabrirla.</span></div>` : ""}
      ${S.confirmClose ? `<div class="confirm"><b>¿Cerrar la Etapa 1 de ${esc(L.equipo)} Wave ${esc(L.wave)}?</b><span class="small">Se envían ${al.filter((a) => a.sev !== "info").length} alertas a los destinos de ${esc(L.equipo)}, los ${L.asesores.length} asesores pasan a Sala y la wave queda cerrada para Reclutamiento.</span><div class="row"><button class="btn danger" id="lb-ok">Sí, cerrar y pasar a Sala</button><button class="btn quiet" id="lb-cancel">Cancelar</button></div></div>`
        : `<div class="row" style="justify-content:flex-end"><button class="btn quiet" id="lb-clear">Descartar archivo</button><button class="btn" id="lb-close" ${bloq.length || L.yaCerrada || S.busy ? "disabled" : ""}>${S.busy ? `<span class="spinner"></span> Cerrando…` : "Cerrar Etapa 1 y pasar a Sala"}</button></div>`}
    </section>`;
  }
  const W = S.waves.filter((w) => inFilter(w.equipo));
  if (W.length) out += `<section class="stack" style="gap:10px"><h3>Waves cerradas</h3><div class="tablewrap"><table class="data"><thead><tr><th>Wave</th><th>Inicio</th><th>Asesores</th><th>Alertas</th><th>Cerrada</th><th>Estado</th></tr></thead><tbody>
    ${W.map((w) => `<tr><td><b>${esc(w.equipo)} · W${esc(w.wave)}</b></td><td class="mono small">${esc(w.fecha_inicio)}</td><td class="mono">${w.asesores.length}</td><td>${w.resumen?.crit ? `<span class="count crit">${w.resumen.crit} críticas</span>` : ""} ${w.resumen?.media ? `<span class="count">${w.resumen.media} medias</span>` : ""}</td><td class="small">${fmtDate(w.cerrada_en)} · ${esc(w.cerrada_por_nombre || "")}</td><td>${w.estado === "sala" ? `<span class="pill p-info">En Sala · cerrada</span>` : `<span class="pill p-warn">Reabierta</span>`}${can.config() && w.estado === "sala" ? ` <button class="btn quiet" data-reabrir="${esc(w.id)}" style="padding:3px 8px">Reabrir</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></section>`;
  return `<div class="stack">${out}</div>`;
}
function bindLibro() {
  const f = $("#lb-file"), dr = $("#lb-drop");
  $("#lb-w").addEventListener("input", (e) => (S._lbWave = e.target.value));
  const load = async (file) => {
    if (!file) return;
    const eq = $("#lb-eq").value; if (!eq) return toast("Selecciona el equipo del libro.");
    const fd = new FormData(); fd.append("equipo", eq); fd.append("wave", $("#lb-w").value.trim()); fd.append("archivo", file);
    S.busy = true; render();
    try { S.libro = await api("/api/libro/preview", { method: "POST", form: fd }); S.confirmClose = false; } catch (e) { toast(e.message); }
    S.busy = false; render();
  };
  f.addEventListener("change", () => load(f.files[0]));
  dr.addEventListener("dragover", (e) => { e.preventDefault(); dr.classList.add("over"); });
  dr.addEventListener("dragleave", () => dr.classList.remove("over"));
  dr.addEventListener("drop", (e) => { e.preventDefault(); dr.classList.remove("over"); load(e.dataTransfer.files[0]); });
  $("#lb-clear")?.addEventListener("click", () => { S.libro = null; render(); });
  $("#lb-close")?.addEventListener("click", () => { S.confirmClose = true; render(); });
  $("#lb-cancel")?.addEventListener("click", () => { S.confirmClose = false; render(); });
  $("#lb-ok")?.addEventListener("click", async () => {
    S.confirmClose = false; S.busy = true; render();
    try { const r = await api("/api/libro/cerrar", { method: "POST", body: { previewId: S.libro.previewId } }); toast(`${S.libro.equipo} Wave ${S.libro.wave} cerrada: ${r.resumen.total} asesores pasan a Sala.`); S.libro = null; await loadAll(); } catch (e) { toast(e.message); }
    S.busy = false; render();
  });
  $$("[data-reabrir]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/api/waves/${b.dataset.reabrir}/reabrir`, { method: "POST" }); S.waves = await api("/api/waves"); toast("Wave reabierta: Reclutamiento puede volver a subir el libro."); render(); } catch (e) { toast(e.message); } }));
}

/* ---------- Etapa 2 (recepción) ---------- */
function etapa2HTML() {
  const W = S.waves.filter((w) => w.estado === "sala" && inFilter(w.equipo));
  return `<div class="stack">
    <div class="banner info"><span><b>Etapa 2 · Sala se conecta en la siguiente fase.</b> Aquí llegan las waves que Reclutamiento cerró, con sus asesores y alertas de origen. Asistencia, procesos disciplinarios y exámenes se suman cuando estén sus archivos.</span></div>
    ${W.length ? W.map((w) => `<details class="panel"><summary>${esc(w.equipo)} · Wave ${esc(w.wave)} <span class="muted small">· inicio ${esc(w.fecha_inicio)} · ${w.asesores.length} asesores</span> ${w.resumen?.crit ? `<span class="count crit">${w.resumen.crit} críticas</span>` : ""}</summary>
      <div class="tablewrap" style="margin-top:12px"><table class="data"><thead><tr><th>Asesor</th><th>Inicio</th><th>Alertas de reclutamiento</th></tr></thead><tbody>
      ${w.asesores.map((a) => `<tr><td><b>${esc(a.nombre)}</b><div class="mono small muted">${esc(a.cedula)}</div></td><td class="mono small">${esc(a.fecha_inicio)}</td><td>${a.alertas.length ? `<div class="chips">${a.alertas.map((t) => `<span class="chip">${esc(t.replace(/_/g, " "))}</span>`).join("")}</div>` : `<span class="pill p-ok">Sin alertas</span>`}</td></tr>`).join("")}
      </tbody></table></div></details>`).join("") : `<div class="empty"><h3>Ninguna wave en Sala todavía</h3><p>Cuando Reclutamiento sube el libro de ingresos y cierra la Etapa 1, la wave aparece aquí.</p></div>`}
  </div>`;
}

/* ---------- Configuración ---------- */
async function loadAdmin() {
  const A = S.admin;
  try {
    const [u, p, d, r] = await Promise.all([api("/api/admin/usuarios"), api("/api/admin/perfiles"), api("/api/admin/destinos"), api("/api/admin/referencias")]);
    A.usuarios = u; A.perfiles = p; A.destinos = d.destinos; A.smtp = d.smtp; A.refs = r;
  } catch (e) { toast(e.message); }
}
function cfgHTML() {
  const A = S.admin, EQ = S.cfg.equipos;
  const meta = (k) => A.refs?.meta.find((m) => m.clave === k);
  const pf = A.perfiles.find((p) => p.equipo === A.pfEq) || { must: [], evaluar: [], no_pedir: [], consistencia_meses: 12 };
  const ds = A.destinos.find((d) => d.equipo === A.dEq) || { slack_webhook: "", emails: [] };
  return `<div class="stack">
  <section class="panel stack">
    <div><p class="eyebrow">Accesos</p><h2>Personas, roles y equipos</h2><p class="muted small" style="margin-top:4px">Quien entra con Google @${esc(S.cfg.dominio)} queda pendiente hasta que le asignes rol y equipos. Cada persona solo ve los equipos que tenga marcados.</p></div>
    <div class="row"><div class="field"><label for="nu-email">Agregar por correo</label><input type="email" id="nu-email" placeholder="nombre@${esc(S.cfg.dominio)}"></div><button class="btn ghost" id="nu-add" style="align-self:flex-end">Agregar</button></div>
    <div class="tablewrap"><table class="data"><thead><tr><th>Persona</th><th>Rol</th><th>Equipos</th><th></th></tr></thead><tbody>
    ${A.usuarios.map((u) => `<tr data-u="${u.id}"><td><b>${esc(u.nombre || "—")}</b><div class="small muted">${esc(u.email)}</div>${u.rol ? "" : `<span class="pill p-warn" style="margin-top:4px">Pendiente</span>`}</td>
      <td><select data-rol style="min-width:170px"><option value="">Sin rol</option>${Object.entries(S.cfg.roles).map(([k, v]) => `<option value="${k}" ${u.rol === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></td>
      <td>${u.rol === "admin" ? `<span class="muted small">Todos los equipos</span>` : ""}<div class="teams" ${u.rol === "admin" ? "hidden" : ""}>${EQ.map((e) => `<label><input type="checkbox" value="${esc(e)}" ${u.equipos.includes(e) ? "checked" : ""}><span>${esc(e)}</span></label>`).join("")}</div></td>
      <td><button class="btn quiet" data-save-u style="padding:5px 10px">Guardar</button></td></tr>`).join("")}
    </tbody></table></div>
  </section>
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <section class="panel stack">
      <div><p class="eyebrow">Alertas</p><h2>Destinos por equipo</h2><p class="muted small" style="margin-top:4px">Cada equipo puede tener su canal de Slack (Incoming Webhook) y sus correos. Si no tiene, se usa el destino general.${A.smtp ? "" : " <b>El correo no saldrá hasta configurar SMTP en Railway.</b>"}</p></div>
      <div class="field"><label for="ds-eq">Destino</label><select id="ds-eq"><option value="*" ${A.dEq === "*" ? "selected" : ""}>General (todos los equipos)</option>${EQ.map((e) => `<option ${e === A.dEq ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></div>
      <div class="field"><label for="ds-hook">Webhook de Slack</label><input type="text" id="ds-hook" class="mono" value="${esc(ds.slack_webhook)}" placeholder="https://hooks.slack.com/services/…"></div>
      <div class="field"><label for="ds-mail">Correos (separados por coma)</label><input type="text" id="ds-mail" value="${esc(ds.emails.join(", "))}"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn quiet" id="ds-test">Enviar prueba</button><button class="btn" id="ds-save">Guardar destino</button></div>
    </section>
    <section class="panel stack">
      <div><p class="eyebrow">Bases de referencia</p><h2>Contra qué se cruza cada cédula</h2></div>
      <div class="kv"><div><b>${(meta("hc")?.total || 0).toLocaleString("es-CO")}</b><span>cédulas en HC Master${meta("hc") ? ` · ${fmtDate(meta("hc").actualizado_en)}` : ""}</span></div><div><b>${meta("no_graduados")?.total || 0}</b><span>no graduados (bloqueo)${meta("no_graduados") ? ` · ${fmtDate(meta("no_graduados").actualizado_en)}` : ""}</span></div><div><b>${A.refs?.waves || 0}</b><span>waves cerradas</span></div></div>
      <div class="row"><label class="btn ghost" for="cf-hc">Subir HC Master (.xlsx)</label><input type="file" id="cf-hc" hidden accept=".xlsx,.xls"><label class="btn ghost" for="cf-ng">Subir no graduados (.xlsx)</label><input type="file" id="cf-ng" hidden accept=".xlsx,.xls,.csv"></div>
      <p class="hint">${S.busy ? `<span class="spinner"></span> Procesando…` : "Del HC se guardan solo cédula, nombre, equipo, estado y fecha de retiro (hojas Activos, Retiros y *_Quit)."}</p>
    </section>
  </div>
  <section class="panel stack">
    <div><p class="eyebrow">Perfiles</p><h2>Perfil exigido por equipo</h2><p class="muted small" style="margin-top:4px">Un requisito por línea. Sin perfil cargado no se puede hacer screening ni cerrar libros de ese equipo.</p></div>
    <div class="field" style="max-width:280px"><label for="pf-eq">Equipo</label><select id="pf-eq">${EQ.map((e) => `<option value="${esc(e)}" ${e === A.pfEq ? "selected" : ""}>${esc(e)}${A.perfiles.some((p) => p.equipo === e) ? "" : " · sin perfil"}</option>`).join("")}</select></div>
    <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
      <div class="field"><label for="pf-must">Obligatorios (must)</label><textarea id="pf-must">${esc(pf.must.join("\n"))}</textarea></div>
      <div class="field"><label for="pf-eval">Evaluar en entrevista</label><textarea id="pf-eval">${esc(pf.evaluar.join("\n"))}</textarea></div>
      <div class="field"><label for="pf-no">No pedir</label><textarea id="pf-no">${esc(pf.no_pedir.join("\n"))}</textarea></div>
    </div>
    <div class="row" style="justify-content:space-between"><div class="field" style="flex:0 1 260px"><label for="pf-cons">Meses mínimos en un empleo</label><input type="text" id="pf-cons" inputmode="numeric" value="${esc(pf.consistencia_meses)}"></div><button class="btn" id="pf-save">Guardar perfil de ${esc(A.pfEq)}</button></div>
  </section></div>`;
}
function bindCfg() {
  const A = S.admin;
  const reload = async () => { await loadAdmin(); render(); };
  $("#nu-add").addEventListener("click", async () => { try { await api("/api/admin/usuarios", { method: "POST", body: { email: $("#nu-email").value } }); toast("Persona agregada: asígnale rol y equipos."); reload(); } catch (e) { toast(e.message); } });
  $$("[data-save-u]").forEach((b) => b.addEventListener("click", async () => {
    const tr = b.closest("tr");
    try { await api(`/api/admin/usuarios/${tr.dataset.u}`, { method: "PUT", body: { rol: $("[data-rol]", tr).value || null, equipos: $$("input[type=checkbox]:checked", tr).map((x) => x.value) } }); toast("Accesos guardados."); reload(); } catch (e) { toast(e.message); }
  }));
  $("#ds-eq").addEventListener("change", (e) => { A.dEq = e.target.value; render(); });
  const dsBody = () => ({ slack_webhook: $("#ds-hook").value, emails: $("#ds-mail").value.split(/[,;\s]+/).filter(Boolean) });
  $("#ds-save").addEventListener("click", async () => { try { await api(`/api/admin/destinos/${encodeURIComponent(A.dEq)}`, { method: "PUT", body: dsBody() }); toast("Destino guardado."); reload(); } catch (e) { toast(e.message); } });
  $("#ds-test").addEventListener("click", async () => { try { const r = await api(`/api/admin/destinos/${encodeURIComponent(A.dEq)}/probar`, { method: "POST" }); toast(`Slack: ${ENV[r.slack]?.[1] || r.slack} · Correo: ${ENV[r.correo]?.[1] || r.correo}`); } catch (e) { toast(e.message); } });
  $("#pf-eq").addEventListener("change", (e) => { A.pfEq = e.target.value; render(); });
  $("#pf-save").addEventListener("click", async () => {
    const lines = (id) => $(id).value.split("\n").map((s) => s.trim()).filter(Boolean);
    try { await api(`/api/admin/perfiles/${encodeURIComponent(A.pfEq)}`, { method: "PUT", body: { must: lines("#pf-must"), evaluar: lines("#pf-eval"), no_pedir: lines("#pf-no"), consistencia_meses: $("#pf-cons").value } }); toast(`Perfil de ${A.pfEq} guardado.`); S.perfiles = Object.fromEntries((await api("/api/perfiles")).map((p) => [p.equipo, p])); reload(); } catch (e) { toast(e.message); }
  });
  const up = (id, url, ok) => $(id).addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("archivo", file); S.busy = true; render();
    try { const r = await api(url, { method: "POST", form: fd }); toast(ok(r.total)); } catch (err) { toast(err.message); }
    S.busy = false; reload();
  });
  up("#cf-hc", "/api/admin/hc", (n) => `HC Master actualizado: ${n.toLocaleString("es-CO")} cédulas.`);
  up("#cf-ng", "/api/admin/no-graduados", (n) => `Lista de no graduados actualizada: ${n} registros.`);
}
