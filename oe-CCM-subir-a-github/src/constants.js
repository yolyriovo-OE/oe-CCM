const EQUIPOS = ["Adultos", "Promo", "Junior", "SVT", "España", "Retención", "Bootcamp", "B2B", "Cobranzas", "Segundo Año", "No Phone"];
const ROLES = { admin: "Administración", reclutador: "Reclutamiento", aprobador: "Aprobador de desbloqueos", training: "Training" };
const FUENTES = ["Computrabajo", "LinkedIn", "Referido", "Puerta", "El Empleo", "Magneto", "Otro portal"];

const PERFIL_ADULTOS = {
  equipo: "Adultos",
  consistenciaMeses: 12,
  must: [
    "Mínimo 1 año (12 meses) de experiencia en ventas",
    "Bachiller completo",
    "Experiencia en venta de intangibles (servicios, educación, seguros, telecomunicaciones, financieros)",
    "Disponibilidad real para el turno (se confirma en entrevista)",
  ],
  evaluar: [
    "Responsabilidad y consistencia",
    "Apego al proceso comercial",
    "Venta de valor (no por precio)",
    "Tolerancia a la frustración",
    "Orientación a resultados y a la comisión",
    "Expectativa salarial y motivación para quedarse",
  ],
  noPedir: ["Inglés o bilingüismo", "Pregrado o título técnico", "Edad, género, hijos o estado civil"],
};

module.exports = { EQUIPOS, ROLES, FUENTES, PERFIL_ADULTOS };
