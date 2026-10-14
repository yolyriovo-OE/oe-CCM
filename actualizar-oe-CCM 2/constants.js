const EQUIPOS = ["Adultos", "Promo", "Junior", "SVT", "España", "Retención", "Bootcamp", "B2B", "Cobranzas", "Segundo Año", "No Phone"];
const COMPETENCIAS = [
  ["responsabilidad", "Responsabilidad"], ["consistencia", "Consistencia"], ["apego", "Apego al proceso"],
  ["valor", "Venta de valor"], ["frustracion", "Tolerancia a la frustración"], ["resultados", "Orientación a resultados"],
];
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
  // Checklist de entrevista (conductas observables, diapositivas 8 y 9 del perfil). Cada bloque se aprueba con el 75 %.
  // Responsabilidad y Consistencia definen la escala AAA; las 6 forman el mapa de habilidades.
  checklist: {
    responsabilidad: [
      "Tiene un compromiso económico que lo motiva a permanecer (estudios, sostener su hogar, etc.)",
      "Sus referencias confirman asistencia y cumplimiento",
    ],
    consistencia: [
      "Duró 1 año o más en al menos un empleo anterior",
      "Sabe sus números de ventas mes a mes",
      "Describe una rutina diaria de llamadas y seguimiento",
      "Se recuperó de un mes malo y cuenta cómo",
    ],
    apego: [
      "En el role play no promete precios ni funciones que no existen",
      "Sigue los pasos de la venta cuando se le indican",
      "Pregunta cuando no sabe, en vez de inventar",
      "Ve la política comercial como parte del trabajo",
    ],
    valor: [
      "Pregunta para entender la necesidad del cliente",
      "Responde la objeción de precio con beneficios, no con descuento",
      "Conecta el curso con una meta del cliente",
      "Cierra con un siguiente paso claro",
    ],
    frustracion: [
      "Cuenta cómo manejó varios rechazos seguidos",
      "Mantiene el tono tras una objeción difícil",
      "Recibe retroalimentación sin ponerse a la defensiva",
      "Habla de metas no cumplidas sin desmotivarse",
    ],
    resultados: [
      "Conoce su meta y su cumplimiento en empleos anteriores",
      "Entiende y le motiva el esquema de comisión",
      "Tiene una meta de crecimiento en ventas a 1 año",
      "Pregunta cómo se mide el desempeño en OE",
    ],
  },
  // Descripción realista del puesto: lo menos atractivo del trabajo, explicado antes de contratar
  rjp: [
    "Meta de ventas mensual y cómo se mide",
    "Horario rotativo, fines de semana y festivos según la operación",
    "Cuánto del ingreso depende de la comisión",
    "Los primeros meses son de aprendizaje; el ingreso crece con el tiempo",
    "Llamadas continuas con rechazos frecuentes",
    "Monitoreo de calidad: no se pueden prometer precios ni funciones",
  ],
};

module.exports = { EQUIPOS, ROLES, FUENTES, COMPETENCIAS, PERFIL_ADULTOS };
