# Auxiliar de Calificaciones ESPOCH

Aplicacion web para que docentes y coordinacion gestionen configuraciones PAO,
RAC/RAAU, actividades, nomina y calificaciones. El sistema consume OASIS por un
BFF Node y guarda la informacion propia de la app en PostgreSQL/Neon.

## Arquitectura activa

```text
Navegador (React + Vite)
  -> /api JSON
BFF Node (server/ + api/index.mjs en Vercel)
  -> SOAP OASIS
  -> PostgreSQL Neon
```

- El navegador no conoce credenciales de OASIS ni `DATABASE_URL`.
- `server/` es el BFF activo para desarrollo local y Vercel.
- `api/index.mjs` reutiliza `server/app.mjs` como funcion serverless.
- Los catalogos RAC, RAAU y procedimientos evaluativos se leen desde Neon
  mediante `/api/catalogo-vectores`; no quedan como vectores locales en el
  runtime del navegador.

## Requisitos

- Node.js 18+
- npm 9+
- PostgreSQL/Neon para persistencia compartida

## Instalacion local

```bash
npm install
cp server/.env.example server/.env
npm run server
npm run dev
```

El frontend local usa `http://localhost:3001` como BFF por defecto. En Vercel
usa rutas relativas `/api/...`.

## Variables de entorno del BFF Node

Configure en `server/.env` para local y en Vercel para produccion:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
OASIS_BASE=http://swoasis.espoch.edu.ec/OASis/OAS_Interop
OASIS_USER=
OASIS_PASS=
CORS_ORIGIN=*
PORT=3001
```

Sin `DATABASE_URL`, la app conserva respaldo local en el navegador, pero no hay
sincronizacion compartida entre equipos.

## Scripts

| Comando | Uso |
| --- | --- |
| `npm run dev` | Frontend Vite local |
| `npm run server` | BFF Node local en `:3001` |
| `npm run db:setup` | Crea/actualiza esquema Neon desde `neon-schema.sql` |
| `npm run lint` | ESLint |
| `npm run build` | Build de produccion Vite |
| `npm run preview` | Preview local del build |

## Estructura

```text
src/
  components/        Componentes React de pantalla
  hooks/             Inicializacion del runtime principal
  services/oasisApi  Cliente HTTP del BFF
  legacyRuntime.js   Logica de negocio y UI legacy activa
server/
  app.mjs            Composition root
  config.mjs         Variables de entorno
  presentation/      HTTP, rutas y controladores
  application/       Casos de uso OASIS
  domain/            Mappers y reglas puras
  infrastructure/    SOAP, XML, Neon y mock fallback
api/index.mjs        Entrada serverless para Vercel
neon-schema.sql      Esquema PostgreSQL activo
public/              Assets estaticos
```

## Endpoints principales

| Metodo | Ruta | Descripcion |
| --- | --- | --- |
| GET | `/api/health` | Estado del BFF |
| GET | `/api/periodo-actual` | Periodo academico actual |
| GET | `/api/carreras` | Carreras activas desde OASIS |
| POST | `/api/login` | Login OASIS |
| POST | `/api/db-login` | Login interno contra Neon |
| POST | `/api/db-password` | Cambio de clave interna |
| POST | `/api/session/claim` | Sesion unica por usuario |
| POST | `/api/session/release` | Libera sesion |
| GET | `/api/store` | Carga configuraciones, estudiantes y notas |
| PUT | `/api/store` | Persiste configuraciones, estudiantes y notas |
| GET | `/api/catalogo-vectores` | Carga catalogos RAC/RAAU/procedimientos desde Neon |
| PUT | `/api/catalogo-vectores` | Sincroniza cambios de catalogo hacia Neon |
| POST | `/api/nomina` | Resuelve carrera/materia/paralelo e importa nomina |
| POST | `/api/docentes-carrera` | Docentes y cargas por carrera |
| POST | `/api/estudiante-full` | Datos, materias y horario de estudiante |
| POST | `/api/export-cache` | Crea enlace temporal para QR/exportacion |

## Deploy en Vercel

1. Configure las variables de entorno indicadas arriba.
2. Ejecute `npm run db:setup` si la BD no tiene el esquema actualizado.
3. Despliegue desde esta carpeta:

```bash
npm run build
npx vercel --prod
```

Vercel ejecuta `npm run build`, publica `dist/` y enruta `/api/:path*` hacia
`api/index.mjs`.

## Notas de mantenimiento

- `node_modules/`, `dist/`, `.env`, logs y carpetas de herramientas locales no
  deben versionarse.
- Chart.js y librerias de exportacion se cargan desde CDN en runtime; no forman
  parte del bundle npm.
