-- Ruta del Asesor · esquema (idempotente: se ejecuta en cada arranque)

CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  nombre      TEXT NOT NULL DEFAULT '',
  foto        TEXT NOT NULL DEFAULT '',
  rol         TEXT,                      -- admin | reclutador | aprobador | training | NULL (pendiente)
  equipos     TEXT[] NOT NULL DEFAULT '{}',
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acceso TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS perfiles (
  equipo             TEXT PRIMARY KEY,
  must               TEXT[] NOT NULL,
  evaluar            TEXT[] NOT NULL DEFAULT '{}',
  no_pedir           TEXT[] NOT NULL DEFAULT '{}',
  consistencia_meses INT NOT NULL DEFAULT 12,
  actualizado_por    INT REFERENCES usuarios(id),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Destinos de alertas: equipo = '*' es el destino general
CREATE TABLE IF NOT EXISTS destinos (
  equipo        TEXT PRIMARY KEY,
  slack_webhook TEXT NOT NULL DEFAULT '',
  emails        TEXT[] NOT NULL DEFAULT '{}'
);

-- Base de referencia: HC Master (activos y retirados)
CREATE TABLE IF NOT EXISTS hc_ref (
  cedula       TEXT PRIMARY KEY,
  nombre       TEXT NOT NULL DEFAULT '',
  equipo       TEXT NOT NULL DEFAULT '',
  estado       TEXT NOT NULL,             -- activo | retirado
  fecha_retiro TEXT NOT NULL DEFAULT '',
  hoja         TEXT NOT NULL DEFAULT ''
);

-- Contratados que nunca se graduaron: bloqueo permanente
CREATE TABLE IF NOT EXISTS no_graduados (
  id           SERIAL PRIMARY KEY,
  cedula       TEXT NOT NULL,
  nombre       TEXT NOT NULL DEFAULT '',
  equipo       TEXT NOT NULL DEFAULT '',
  wave         TEXT NOT NULL DEFAULT '',
  resultado    TEXT NOT NULL DEFAULT '',
  fecha_inicio TEXT NOT NULL DEFAULT '',
  estado_caso  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS no_graduados_cedula ON no_graduados(cedula);

CREATE TABLE IF NOT EXISTS ref_meta (
  clave        TEXT PRIMARY KEY,
  total        INT NOT NULL,
  actualizado_por INT REFERENCES usuarios(id),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidatos (
  id            SERIAL PRIMARY KEY,
  cedula        TEXT NOT NULL,
  nombre        TEXT NOT NULL DEFAULT '',
  equipo        TEXT NOT NULL,
  fuente        TEXT NOT NULL DEFAULT '',
  link          TEXT NOT NULL DEFAULT '',
  estado        TEXT NOT NULL,             -- screening | entrevista | espera | descartado | bloqueado | contratado
  recomendacion TEXT NOT NULL DEFAULT '',  -- avanza | avanza_con_dudas | no_cumple_must | bloqueado
  prechecks     JSONB NOT NULL DEFAULT '[]',
  screening     JSONB,
  comentario    TEXT NOT NULL DEFAULT '',
  reclutador_id INT REFERENCES usuarios(id),
  wave_id       TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_en   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS candidatos_cedula ON candidatos(cedula);
CREATE INDEX IF NOT EXISTS candidatos_equipo ON candidatos(equipo);

CREATE TABLE IF NOT EXISTS desbloqueos (
  cedula          TEXT PRIMARY KEY,
  nombre          TEXT NOT NULL DEFAULT '',
  equipo          TEXT NOT NULL,
  antecedente     TEXT NOT NULL DEFAULT '',
  solicitud       TEXT NOT NULL,
  candidato_id    INT REFERENCES candidatos(id),
  solicitado_por  INT REFERENCES usuarios(id),
  solicitado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado          TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobado | rechazado
  comentario      TEXT NOT NULL DEFAULT '',
  resuelto_por    INT REFERENCES usuarios(id),
  resuelto_en     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS waves (
  id           TEXT PRIMARY KEY,           -- adultos_2026_w01
  equipo       TEXT NOT NULL,
  wave         TEXT NOT NULL,
  fecha_inicio TEXT NOT NULL DEFAULT '',
  estado       TEXT NOT NULL,              -- sala | reabierta
  archivo      TEXT NOT NULL DEFAULT '',
  hoja         TEXT NOT NULL DEFAULT '',
  resumen      JSONB NOT NULL DEFAULT '{}',
  cerrada_por  INT REFERENCES usuarios(id),
  cerrada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wave_asesores (
  wave_id        TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
  cedula         TEXT NOT NULL,
  nombre         TEXT NOT NULL DEFAULT '',
  fecha_inicio   TEXT NOT NULL DEFAULT '',
  educacion      TEXT NOT NULL DEFAULT '',
  meses_ultima   TEXT NOT NULL DEFAULT '',
  disponibilidad TEXT NOT NULL DEFAULT '',
  reintegro      TEXT NOT NULL DEFAULT '',
  fuente         TEXT NOT NULL DEFAULT '',
  alertas        TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (wave_id, cedula)
);
CREATE INDEX IF NOT EXISTS wave_asesores_cedula ON wave_asesores(cedula);

CREATE TABLE IF NOT EXISTS libro_previews (
  id         TEXT PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id),
  datos      JSONB NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alertas (
  id           SERIAL PRIMARY KEY,
  etapa        INT NOT NULL DEFAULT 1,
  tipo         TEXT NOT NULL,
  sev          TEXT NOT NULL,              -- crit | media | info
  titulo       TEXT NOT NULL,
  mensaje      TEXT NOT NULL DEFAULT '',
  cedula       TEXT NOT NULL DEFAULT '',
  nombre       TEXT NOT NULL DEFAULT '',
  equipo       TEXT NOT NULL,
  wave         TEXT NOT NULL DEFAULT '',
  candidato_id INT,
  envio_slack  TEXT NOT NULL DEFAULT 'pendiente',
  envio_correo TEXT NOT NULL DEFAULT 'pendiente',
  revisada     BOOLEAN NOT NULL DEFAULT FALSE,
  revisada_por INT REFERENCES usuarios(id),
  creado_por   INT REFERENCES usuarios(id),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alertas_equipo ON alertas(equipo, creado_en DESC);

-- Origen y estado de la última sincronización de cada base de referencia
ALTER TABLE ref_meta ADD COLUMN IF NOT EXISTS fuente TEXT NOT NULL DEFAULT '';
ALTER TABLE ref_meta ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '';

-- Escala AAA / AA / Regular
ALTER TABLE perfiles   ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '{}';
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS clasificacion_previa TEXT NOT NULL DEFAULT '';
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS clasificacion TEXT NOT NULL DEFAULT '';
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS checklist JSONB;

-- Descripción realista del puesto y evaluación a tiempo
ALTER TABLE perfiles   ADD COLUMN IF NOT EXISTS rjp TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS rjp JSONB;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS alerta_eval_24h BOOLEAN NOT NULL DEFAULT FALSE;
