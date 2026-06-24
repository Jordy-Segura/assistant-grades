# Auxiliar de Calificaciones — ESPOCH

Aplicación web (React + Vite) para que los docentes configuren resultados de
aprendizaje (RAC/RAAU), actividades de evaluación y registren calificaciones,
con un panel de coordinación. Integra los servicios SOAP de **OASIS** (Sistema
Académico Integrado de la ESPOCH) a través de un **BFF** (backend intermedio).

## Arquitectura

```
Navegador (React + Vite)  ──JSON──►  BFF (backend/ PHP 8+)  ──SOAP──►  OASIS .asmx
                                          │
                                          └──► PostgreSQL (datos propios de la app)
```

- El frontend **nunca** habla SOAP ni conoce credenciales de servicio.
- El BFF (`backend/`, PHP 8+) es el único que arma los envelopes SOAP y guarda las
  credenciales (`OASIS_USER` / `OASIS_PASS`) en variables de entorno.
- El BFF original en Node.js (`server/`) queda como referencia histórica.

### ¿Node o PHP?

| BFF       | Estado   | Recomendado | Puerto |
|-----------|----------|-------------|--------|
| `backend/` (PHP 8+) | **Activo** | ✅ Sí | `3001` |
| `server/` (Node.js) | Legacy/referencia | ❌ No | `3001` (alternativo) |

Ambos implementan los mismos endpoints REST. El frontend apunta a
`VITE_API_BASE_URL=http://localhost:3001` (configurable en `.env`).

### Servicios OASIS consumidos

| Servicio SOAP        | Operación                          | Uso en la app                                |
|----------------------|------------------------------------|----------------------------------------------|
| `Seguridad.asmx`     | `AutenticarUsuarioCarrera`         | Inicio de sesión (roles por carrera)         |
| `Seguridad.asmx`     | `GetUsuarioFacultad`               | Correo institucional / **WebMail**           |
| `InfoGeneral.asmx`   | `GetPeriodoActual`                 | Autocompletar período académico              |
| `InfoGeneral.asmx`   | `GetTodasCarreras`                 | Resolver carrera → código OASIS              |
| `InfoCarrera.asmx`   | `GetMallaCurricularPensumVigente…` | Resolver asignatura → código + nivel         |
| `InfoCarrera.asmx`   | `GetDictadosMateria`               | Paralelo, nivel y **docente** de la materia  |
| `InfoCarrera.asmx`   | `GetAlumnosMateria`                | Nómina real de estudiantes                   |
| `InfoCarrera.asmx`   | `GetHorariosDocente`               | Horario semanal de cada docente              |
| `InfoCarrera.asmx`   | `GetUltimasNotasEstudianteCarrera` | Últimas notas (endpoint disponible)          |

### Funciones automáticas

- **Importar nómina (un clic):** en *Estudiantes → Importar de OASIS*, la app toma
  la carrera + asignatura ya configuradas, resuelve sus códigos OASIS
  (carrera → malla → dictado → paralelo) y trae la nómina real automáticamente.
  Si no puede resolver o el BFF está caído, ofrece un ingreso manual de códigos.
- **Coordinación → Importar docentes (OASIS):** trae todos los docentes que
  dictan en una carrera con sus **cargas horarias** (materia · nivel · paralelo)
  y les crea un perfil de acceso.

> Nota: el `<credentials>` de servicio no es obligatorio para estas lecturas; el
> *login real* sí requiere `OASIS_USER`/`OASIS_PASS`.

## Requisitos

- **PHP 8.0+** con extensiones: `curl`, `openssl`, `mbstring`, `pdo_pgsql`, `pgsql`
- **Node.js** 18+ (solo para el frontend con Vite)
- **npm** 9+
- **PostgreSQL** (opcional — sin BD la app usa `sessionStorage`)

## Puesta en marcha (con BFF PHP — recomendado)

### 1. Clonar e instalar dependencias del frontend

```bash
git clone https://github.com/Jordy-Segura/assistant-grades-.git
cd assistant-grades-
npm install
```

### 2. Configurar variables de entorno

Crea `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

Edita `backend/.env`:

```env
OASIS_BASE=http://swoasis.espoch.edu.ec/OASis/OAS_Interop
OASIS_USER=                        # vacío → login local (dev)
OASIS_PASS=
OASIS_TIMEOUT=25
DATABASE_URL=                      # opcional, ver sección BD
CORS_ORIGIN=*
LOG_DIR=logs
```

> `OASIS_USER` y `OASIS_PASS` vacíos: las operaciones de solo lectura
> (carreras, malla, nómina, docentes, horarios) funcionan sin auth.
> El login real requiere credenciales institucionales OASIS.

### 3. Iniciar backend PHP (BFF)

```bash
php -c backend/php.ini -S 127.0.0.1:3001 backend/public/index.php
# → http://localhost:3001
# Log: "PostgreSQL conectado y esquema listo." (o aviso de sessionStorage)
```

### 4. Iniciar frontend (segunda terminal)

```bash
npm run dev
# → http://localhost:5173
```

### 5. Probar

1. Abre `http://localhost:5173`
2. Inicia sesión con: `ppaguay@espoch.edu.ec` / `paguay2026`
3. Ve a **Coordinación → Importar docentes (OASIS)**, selecciona
   `TECNOLOGIAS DE LA INFORMACION` (ITIO) → verás los docentes reales
4. Ve a **Estudiantes → Importar de OASIS**, escribe
   `FUNDAMENTOS DE PROGRAMACION` → se resolverán los códigos automáticamente
   y se importarán los estudiantes reales de Sede Orellana

## Puesta en marcha alternativa (con BFF Node — legacy)

```bash
cp server/.env.example server/.env   # editar DATABASE_URL si se requiere
npm run server                       # inicia BFF en :3001
npm run dev                          # frontend en :5173
```

## Base de datos (PostgreSQL en la nube)

Los datos **propios de la app** (docentes, asignaciones, configuraciones,
estudiantes y notas) se guardan en PostgreSQL a través del BFF. Los datos
académicos (carreras, malla, horarios, nómina) se siguen consultando en vivo a
OASIS. Sin `DATABASE_URL`, la app usa `localStorage` como respaldo (no se
comparte entre PCs y se pierde al cerrar).

### Conectar Neon / Supabase (gratis) en 4 pasos

1. Crea una cuenta en [neon.tech](https://neon.tech) o [supabase.com](https://supabase.com) y un proyecto (Postgres).
2. Copia el **connection string** (formato `postgresql://usuario:clave@host:5432/nombrebd`).
3. Pégalo en `backend/.env` como `DATABASE_URL=...`.
4. Al reiniciar el BFF PHP, crea las tablas e inserta al coordinador automáticamente.

> La contraseña del coordinador y de los docentes se guarda **hasheada**
> (bcrypt en PHP, scrypt en Node). El login se verifica primero localmente,
> luego contra la BD (`/api/db-login`) y por último contra OASIS.

### Tablas

`docente`, `asignacion`, `configuracion`, `config_estudiantes`, `config_notas`
(claves consultables + `JSONB` para la estructura flexible de cada entidad).

## Acceso y roles

- **Coordinador (cuenta base):** `ppaguay@espoch.edu.ec` · `paguay2026`
  (PAUL PAGUAY, clave temporal de prueba — cámbiala desde *Perfil*).
- **Docentes:** el coordinador los **importa desde OASIS** (con sus cargas
  horarias) o los crea a mano, y les **asigna una contraseña**. El docente
  ingresa con su correo + esa contraseña, o con sus credenciales OASIS reales.
- El login intenta primero la cuenta local; si no existe, autentica contra OASIS.

### Reglas de negocio

- Cada **docente solo ve y configura sus propias asignaturas** (las que le
  asignó el coordinador). La nómina se importa con los códigos OASIS exactos
  de esa asignación.
- En **Actividades**, los puntos de cada componente deben sumar su peso
  (ACD 3.5 · APEX 3.5 · AAUT 3.0 = 10) para poder guardar.
- En **Calificaciones**, se navega con Enter/Tab y con las flechas ↑↓←→.
- Cada usuario tiene una **configuración de perfil** (datos + cambio de clave).

## Endpoints del BFF

| Método | Ruta                    | Descripción                          |
|--------|-------------------------|--------------------------------------|
| GET    | `/api/health`           | Estado del BFF y si hay credenciales |
| GET    | `/api/periodo-actual`   | Período académico actual             |
| GET    | `/api/facultades`       | Catálogo de facultades               |
| POST   | `/api/login`            | `{login, password}` → roles + perfil |
| GET    | `/api/carreras`         | Carreras abiertas (código + nombre)  |
| POST   | `/api/nomina`           | Resuelve y devuelve nómina           |
| POST   | `/api/docentes-carrera` | Docentes + cargas horarias           |
| POST   | `/api/horario-docente`  | Horario semanal del docente          |
| POST   | `/api/materias-docente` | Materias que dicta un docente        |
| POST   | `/api/alumnos-materia`  | Estudiantes de una materia/paralelo  |
| POST   | `/api/notas`            | Últimas notas de un estudiante       |
| GET    | `/api/db/health`        | Estado de la BD                      |
| GET    | `/api/store`            | Obtener store completo               |
| PUT    | `/api/store`            | Guardar store completo               |
| POST   | `/api/db-login`         | Login contra BD (password hasheado)  |
| POST   | `/api/dev-login`        | Login de desarrollo (sin OASIS)      |

## Estructura del proyecto

```
├── src/              → Frontend React + Vite
│   ├── components/   → Componentes JSX (AuthScreen, Sidebar, Pages)
│   ├── services/     → Clientes HTTP (oasisApi.js, supabase.js)
│   ├── hooks/        → Hooks React (useLegacyRuntime)
│   ├── workers/      → Web Workers (anomalyWorker)
│   └── legacyRuntime.js  ← Lógica principal (JS vanilla)
├── backend/          → BFF activo (PHP 8+, N-capas) ← RECOMENDADO
│   ├── public/       → Front controller (index.php)
│   └── app/          → Capas: Soap, OasisService, Database, Controllers
├── server/           → BFF legacy (Node.js, sin dependencias) ← REFERENCIA
└── supabase-schema.sql → Esquema SQL para Supabase
```
