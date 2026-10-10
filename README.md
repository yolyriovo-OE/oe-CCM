# Ruta del Asesor

App de training administrativo de Open English. Une en un solo lugar las alertas de cada etapa del asesor:

1. **Reclutamiento**: screening de hojas de vida con IA, bloqueos, reintegros y cierre con el libro de ingresos.
2. **Sala**: recibe las waves cerradas. Asistencia, procesos disciplinarios y exámenes se conectan en la siguiente fase.
3. **OJT**: ventas y calidad (próximamente).

## Cómo funciona la Etapa 1

1. **El reclutador monta la información.** Elige el equipo al que aplica el candidato (es obligatorio), escribe la cédula y adjunta la hoja de vida: PDF, Word, imagen o texto pegado de LinkedIn u otro portal.
2. **La app revisa y alerta.** Primero cruza la cédula contra la lista de no graduados (bloqueo), el HC Master (reintegros), las waves anteriores y las cédulas duplicadas. Si no hay bloqueo, Claude evalúa la hoja de vida **solo contra el perfil del equipo elegido**. Las alertas se envían al Slack y a los correos de ese equipo.
3. **El reclutador decide y cierra.** Registra su decisión. Cuando contrata, sube el libro de ingresos: la app lo cruza de nuevo y, al cerrarlo, la wave pasa a Sala y queda cerrada para Reclutamiento.

### El equipo manda en todo

- Cada persona solo ve los equipos que Administración le asignó: candidatos, libros, alertas, desbloqueos y waves.
- Sin perfil cargado para un equipo, no se puede hacer screening ni cerrar libros de ese equipo.
- En el libro de ingresos solo cuenta el screening hecho para **el mismo equipo**. Si la persona se evaluó para otro equipo, sale la alerta.
- Cada equipo puede tener su propio canal de Slack y sus propios correos. Si no los tiene, se usa el destino general.

### Roles

| Rol | Ve |
|---|---|
| Administración | Todo, más Configuración: personas, perfiles, destinos y bases de referencia |
| Reclutamiento | Etapa 1 de sus equipos |
| Aprobador de desbloqueos | Cola de desbloqueos de sus equipos y la Etapa 2 |
| Training | Etapa 2 · Sala de sus equipos |

---

## Despliegue en Railway

### 1. Subir el código a GitHub
Crea un repositorio privado (por ejemplo `ruta-del-asesor`) y sube esta carpeta.

### 2. Crear el proyecto en Railway
1. En Railway: **New Project → Deploy from GitHub repo** y elige el repositorio.
2. En el mismo proyecto: **New → Database → PostgreSQL**.
3. En el servicio de la app, ve a **Variables** y agrega `DATABASE_URL` como referencia a la variable `DATABASE_URL` del Postgres.
4. En **Settings → Networking**, genera un dominio público (por ejemplo `ruta-del-asesor.up.railway.app`).

### 3. Variables de entorno

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL` | Sí | Referencia al Postgres de Railway |
| `NODE_ENV` | Sí | `production` |
| `SESSION_SECRET` | Sí | Frase larga y aleatoria (32+ caracteres) |
| `GOOGLE_CLIENT_ID` | Sí | Cliente OAuth de Google (paso 4) |
| `ALLOWED_DOMAIN` | Sí | `openenglish.com` |
| `ADMIN_EMAILS` | Sí | Correos que entran como Administración, separados por coma |
| `ANTHROPIC_API_KEY` | Sí | API key de Anthropic para el screening |
| `ANTHROPIC_MODEL` | No | Por defecto `claude-sonnet-5-5` |
| `APP_URL` | No | URL pública; se incluye en las alertas |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | Para enviar alertas por correo |

### 4. Login con Google (@openenglish.com)
1. En [Google Cloud Console](https://console.cloud.google.com/), crea o elige un proyecto de la organización.
2. **APIs y servicios → Pantalla de consentimiento OAuth**: tipo **Interno**, para que solo entren cuentas de Open English.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**.
4. En **Orígenes de JavaScript autorizados**, agrega el dominio de Railway (`https://ruta-del-asesor.up.railway.app`).
5. Copia el ID de cliente en `GOOGLE_CLIENT_ID`.

La app además verifica en el servidor que la cuenta sea del dominio `ALLOWED_DOMAIN`.

### 5. Alertas por Slack
Por cada canal: en Slack, **Apps → Incoming Webhooks → Add to Slack**, eliges el canal y copias la URL `https://hooks.slack.com/services/…`. Luego, en la app: **Configuración → Destinos por equipo**. Con **Enviar prueba** compruebas que llegue.

### 6. Alertas por correo
Con Google Workspace, usa una cuenta de servicio de alertas con contraseña de aplicación:
`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER` = la cuenta y `SMTP_PASS` = la contraseña de aplicación. También sirve el SMTP relay de Workspace o cualquier proveedor SMTP.

### 7. Primer uso
1. Entra con una cuenta de `ADMIN_EMAILS`.
2. **Configuración → Bases de referencia**: sube el **HC Master (.xlsx)** y la lista de **no graduados (.xlsx)**.
3. **Perfiles**: Adultos viene cargado. Carga el perfil de cada equipo antes de usarlo.
4. **Personas**: cuando alguien entra con Google queda pendiente. Asígnale rol y equipos.
5. **Destinos**: configura el Slack y los correos generales y, si aplica, los de cada equipo.

---

## Desarrollo local

```bash
npm install
cp .env.example .env    # ajusta DATABASE_URL
npm run dev             # habilita "Entrar sin Google" solo en desarrollo
npm test
```

## Datos y privacidad
- Del HC Master solo se guardan cédula, nombre, equipo, estado y fecha de retiro.
- Del libro de ingresos solo se guardan cédula, nombre, fecha de inicio, escolaridad, meses en la última empresa, disponibilidad, reintegro y fuente. **No** se guardan contraseñas, direcciones, EPS, RH, hijos ni contactos de emergencia, aunque vengan en el archivo.
- La hoja de vida se envía a Claude para el análisis y no se guarda el archivo. Se guarda solo el resultado del screening.
- La IA tiene instrucción de ignorar edad, género, hijos, estado civil, foto, dirección, nacionalidad, religión y salud.
- La IA nunca descarta sola: siempre decide el reclutador, y su decisión queda registrada.
