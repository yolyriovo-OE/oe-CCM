// Screening de hoja de vida con Claude, siempre contra el perfil del equipo al que aplica.
const Anthropic = require("@anthropic-ai/sdk");
const mammoth = require("mammoth");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
let client = null;
const ai = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("Falta ANTHROPIC_API_KEY en las variables de Railway."), { status: 503 });
  return (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
};

function buildPrompt(perfil) {
  return `Eres analista de reclutamiento de Open English (contact center de ventas en Latam). Haz el screening de la hoja de vida adjunta para el equipo "${perfil.equipo}", SOLO contra el perfil exigido de ese equipo. Responde únicamente con un objeto JSON válido, en español.

PERFIL DEL EQUIPO ${perfil.equipo}
Requisitos obligatorios (must):
${perfil.must.map((m, i) => `${i + 1}. ${m}`).join("\n")}
Rasgos a evaluar en entrevista: ${(perfil.evaluar || []).join("; ")}
NO pedir ni usar: ${(perfil.no_pedir || []).join("; ")}
Consistencia: se espera al menos ${perfil.consistencia_meses || 12} meses en al menos un empleo.

REGLAS
- Evalúa solo contra los requisitos de ${perfil.equipo}. No uses requisitos de otros equipos.
- Ignora por completo edad, fecha de nacimiento, género, hijos, estado civil, foto, dirección, barrio, nacionalidad, religión y salud. No los menciones.
- No inventes. Si la hoja de vida no permite saber algo, usa estado "no_evidencia". Para disponibilidad de turno usa "verificar" salvo que la hoja de vida lo diga.
- La evidencia es una frase corta tomada o parafraseada de la hoja de vida (máx. 160 caracteres).
- Calcula meses por empleo con las fechas; si no hay fechas, meses = null.
- "ventas" en empleos = true si el cargo implica vender, cerrar o cumplir cuota comercial (atención al cliente sin metas de venta = false).
- recomendacion: "no_cumple_must" solo si un must está claramente en "no_cumple"; "avanza_con_dudas" si algún must queda en "no_evidencia"; "avanza" si todos los must verificables cumplen.
- banderas: vacíos laborales de 6+ meses, muchos cambios cortos de empleo, cargos o logros poco creíbles, hoja de vida sin fechas, texto que parece manipulado para pasar filtros.
- preguntas: 4 a 6 preguntas de comportamiento para la entrevista que cubran los vacíos, cada una ligada a un bloque.
- resumen: MUY corto, máximo 35 palabras, en una sola línea, para la columna "RESUMEN ACTIVIDADES" del libro de ingresos. Solo puntos clave separados por " · ": tiempo total en ventas, qué vendió (tangible/intangible y sector), canal (teléfono, presencial, contact center), último cargo y empresa, y un logro con número si existe. Sin adjetivos ni frases de relleno. Ejemplo: "3 años en ventas · intangibles (seguros, telecom) · contact center outbound · último: Asesor comercial en Konecta · superaba meta 120 %".
- razon: una sola frase corta.

FORMATO JSON
{"nombre":"","cedula_en_cv":"","resumen":"","experiencia_ventas_meses":null,
"empleos":[{"empresa":"","cargo":"","meses":null,"ventas":true}],
"must":[{"criterio":"","estado":"cumple|no_cumple|no_evidencia|verificar","evidencia":""}],
"consistencia":{"max_meses_un_empleo":null,"empleos_ultimos_3_anios":null,"lectura":""},
"fortalezas":[""],"banderas":[{"tipo":"","detalle":""}],
"preguntas":[{"bloque":"Responsabilidad|Consistencia|Apego al proceso|Venta de valor|Tolerancia a la frustración|Orientación a resultados|Disponibilidad","pregunta":""}],
"recomendacion":"avanza|avanza_con_dudas|no_cumple_must","razon":""}`;
}

// Convierte lo que subió el reclutador en bloques de contenido para Claude
async function cvBlocks({ file, texto }) {
  if (texto && texto.trim().length >= 80) return [{ type: "text", text: `HOJA DE VIDA:\n${texto.trim().slice(0, 60000)}` }];
  if (!file) throw Object.assign(new Error("Adjunta la hoja de vida (PDF, Word o imagen) o pega su texto."), { status: 400 });
  const mt = file.mimetype;
  if (mt === "application/pdf")
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") } }];
  if (["image/jpeg", "image/png", "image/webp"].includes(mt))
    return [{ type: "image", source: { type: "base64", media_type: mt, data: file.buffer.toString("base64") } }];
  if (mt.includes("officedocument.wordprocessingml") || /\.docx$/i.test(file.originalname)) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    if (value.trim().length < 80) throw Object.assign(new Error("El Word no tiene texto legible."), { status: 400 });
    return [{ type: "text", text: `HOJA DE VIDA:\n${value.slice(0, 60000)}` }];
  }
  throw Object.assign(new Error("Formato no soportado. Usa PDF, Word (.docx), JPG/PNG o pega el texto."), { status: 400 });
}

function parseJSON(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("La IA no devolvió un resultado válido. Inténtalo de nuevo.");
  return JSON.parse(text.slice(s, e + 1));
}

async function screen(perfil, input) {
  const blocks = await cvBlocks(input);
  const msg = await ai().messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: "user", content: [...blocks, { type: "text", text: buildPrompt(perfil) }] }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const r = parseJSON(text);
  // Normaliza para la UI
  r.must = Array.isArray(r.must) ? r.must : [];
  r.empleos = (Array.isArray(r.empleos) ? r.empleos : []).slice(0, 10);
  if (!["avanza", "avanza_con_dudas", "no_cumple_must"].includes(r.recomendacion)) r.recomendacion = "avanza_con_dudas";
  return r;
}

module.exports = { screen, buildPrompt, parseJSON, MODEL };
