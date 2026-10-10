const test = require("node:test");
const assert = require("node:assert");
const R = require("./rules");

const emptyCtx = () => ({ hc: new Map(), ng: new Map(), desbloqueos: new Map(), waves: new Map(), candidatos: new Map() });
const perfil = { equipo: "Adultos", must: ["Mínimo 1 año en ventas", "Bachiller completo"], consistencia_meses: 12 };

function libroWB(rows) {
  const header = ["", "FECHA DE INICIO", "CEDULA", "NOMBRES", "APELLIDOS", "PERFIL", "LINK HOJA DE VIDA", "RESUMEN ACTIVIDADES DE SU ÚLTIMA EXPERIENCIA", "REINTEGRO ", "DISPONIBILIDAD", "TIEMPO EN LA ÚLTIMA EMPRESA (EN MESES)", "NIVEL EDUCATIVO", "ÚLTIMA EMPRESA EN LA QUE LABORO"];
  const ws = R.XLSX.utils.aoa_to_sheet([header, ...rows, [], ["RETIROS"], ["x", "1/1/2026", "999999999", "NO", "LEER"]]);
  const wb = R.XLSX.utils.book_new();
  R.XLSX.utils.book_append_sheet(wb, ws, "Libro de ingresos ESP");
  return wb;
}

test("parseLibro lee la hoja ESP y se detiene en RETIROS", () => {
  const wb = libroWB([["", "5/10/2026", "1.234.567", "ANA", "PÉREZ", "", "", "", "No", "Completa", "24", "BACHILLER", "Empresa A"]]);
  const L = R.parseLibro(wb);
  assert.equal(L.hoja, "Libro de ingresos ESP");
  assert.equal(L.asesores.length, 1);
  assert.equal(L.asesores[0].cedula, "1234567");
  assert.equal(L.asesores[0].nombre, "ANA PÉREZ");
});

test("bloqueo por no graduado y cédula duplicada con otro nombre", () => {
  const ctx = emptyCtx();
  ctx.ng.set("1111111", [{ nombre: "Pedro Gómez", equipo: "SVT", wave: "4", resultado: "Renuncia Voluntaria" }]);
  const p = R.prechecks("1111111", "Ana Pérez", "Adultos", ctx);
  assert.ok(p.find((x) => x.tipo === "bloqueado" && x.sev === "crit"));
  assert.ok(p.find((x) => x.tipo === "duplicada"));
});

test("desbloqueo aprobado levanta el bloqueo", () => {
  const ctx = emptyCtx();
  ctx.ng.set("1111111", [{ nombre: "Ana Pérez", equipo: "Adultos", wave: "1" }]);
  ctx.desbloqueos.set("1111111", { estado: "aprobado", comentario: "ok" });
  const p = R.prechecks("1111111", "Ana Pérez", "Adultos", ctx);
  assert.ok(!p.find((x) => x.tipo === "bloqueado"));
});

test("reintegro: alerta si no se reporta, nada si se reporta", () => {
  const ctx = emptyCtx();
  ctx.hc.set("2222222", { nombre: "Luis Ruiz", equipo: "Cobranzas", estado: "retirado", fecha_retiro: "03/2023" });
  assert.ok(R.prechecks("2222222", "Luis Ruiz", "Adultos", ctx).find((x) => x.tipo === "reintegro"));
  assert.ok(!R.prechecks("2222222", "Luis Ruiz", "Adultos", ctx, { reintegroReportado: true }).find((x) => x.tipo === "reintegro"));
});

test("el screening válido para el libro es el del mismo equipo", () => {
  const ctx = emptyCtx();
  ctx.candidatos.set("3333333", [{ id: 1, equipo: "Promo", estado: "entrevista", recomendacion: "avanza", creado_en: "2026-10-01" }]);
  const L = { equipo: "Adultos", wave: "1", waveId: "adultos_2026_w01", asesores: [{ cedula: "3333333", nombre: "Eva Díaz", fecha: "5/10/2026", reintegro: "no", disponibilidad: "Completa", educacion: "BACHILLER", meses: "20" }] };
  const al = R.evaluarLibro(L, perfil, ctx);
  const s = al.find((a) => a.tipo === "sin_screening");
  assert.ok(s);
  assert.match(s.titulo, /otro equipo/);
});

test("libro: escolaridad, disponibilidad vacía, consistencia y cédula repetida", () => {
  const L = { equipo: "Adultos", wave: "1", waveId: "x", asesores: [
    { cedula: "4444444", nombre: "Uno", fecha: "5/10/2026", reintegro: "no", disponibilidad: "", educacion: "PRIMARIA", meses: "6" },
    { cedula: "4444444", nombre: "Dos", fecha: "5/10/2026", reintegro: "no", disponibilidad: "AM", educacion: "BACHILLER", meses: "30" },
  ] };
  const tipos = R.evaluarLibro(L, perfil, emptyCtx()).map((a) => a.tipo);
  ["educacion", "dato_vacio", "consistencia", "duplicada_libro"].forEach((t) => assert.ok(tipos.includes(t), t));
});

test("waveId estable", () => {
  assert.equal(R.waveId("Segundo Año", "1", [{ fecha: "5/10/2026" }]), "segundo-ano_2026_w01");
});

test("teamFromCampaign mapea nombres del HC", () => {
  assert.equal(R.teamFromCampaign("OE Sales Colombia Collection"), "Cobranzas");
  assert.equal(R.teamFromCampaign("Retention_Quit"), "Retención");
  assert.equal(R.teamFromCampaign("OE Adulto"), "Adultos");
});
