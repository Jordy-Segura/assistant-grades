# Backend PHP (arquitectura N capas)

Backend del Auxiliar de Calificaciones. Es lo único que habla SOAP con OASIS y
con la base de datos; el navegador solo intercambia JSON con él.

## Capas

```
Presentación     public/index.php (front controller + router) · app/Controllers.php
Aplicación       app/OasisService.php  (lógica de negocio + resolución)
Infraestructura  app/Soap.php (cliente SOAP) · app/Database.php (PostgreSQL/PDO)
Transversal      app/Config.php · app/Logger.php · app/Http.php (CORS, validación)
```

Seguridad: contraseñas con `password_hash` (bcrypt), consultas con sentencias
preparadas (PDO), validación de entrada, credenciales solo en `.env` (servidor).

---

## Qué tienes que hacer TÚ

### 1. Tener PHP con extensiones

Necesitas **PHP 8.0+** con: `curl`, `openssl`, `mbstring`, `pdo_pgsql`, `pgsql`.
La forma más fácil es **XAMPP** (ya trae casi todo). En su `php.ini` deja sin
`;` estas líneas:

```ini
extension=curl
extension=openssl
extension=mbstring
extension=pdo_pgsql
extension=pgsql
```

> Hay un `backend/php.ini` listo. Si tu PHP no encuentra las extensiones,
> abre ese archivo y ajusta `extension_dir` a la carpeta `ext` de tu PHP.

### 2. Crear la base de datos en Supabase (gratis)

1. Entra a [supabase.com](https://supabase.com) → crea un proyecto.
2. **Project Settings → Database → Connection string → URI**, y copia la del
   **Connection pooler** (recomendado, funciona en cualquier red).
   Se ve así: `postgresql://postgres.xxxx:CLAVE@aws-0-...pooler.supabase.com:6543/postgres`
3. Pega esa URL en `backend/.env` → `DATABASE_URL=...`

> 0.5 GB sobran: tus datos son texto (unos pocos MB por carrera-período).

### 3. Levantar el backend

Desde la carpeta del proyecto:

```bash
php -c backend/php.ini -S 127.0.0.1:3001 backend/public/index.php
```

- En la consola debe poder responder `http://127.0.0.1:3001/api/health`.
- Si configuraste `DATABASE_URL`, en `backend/logs/` verás
  *"PostgreSQL conectado y esquema listo."* (crea las tablas solo).

### 4. Levantar el frontend

```bash
npm install
npm run dev
```

El frontend ya apunta a `http://localhost:3001`, así que **no hay que cambiar
nada**. (Si corres el backend en otro puerto, crea un `.env` en la raíz con
`VITE_API_BASE_URL=http://localhost:TUPUERTO`.)

---

## Acceso

- **Coordinador:** `ppaguay@espoch.edu.ec` / `paguay2026` (clave temporal; el
  backend la guarda hasheada y la puedes cambiar desde *Perfil*).
- Los docentes los importa/crea el coordinador y les asigna contraseña.

## ¿Y el backend en Node (`server/`)?

Quedó como referencia. Con PHP ya no lo necesitas; puedes borrar la carpeta
`server/` si quieres.

## Endpoints

`GET /api/health`, `/api/periodo-actual`, `/api/facultades`, `/api/carreras`,
`/api/db/health` · `POST /api/nomina`, `/api/docentes-carrera`,
`/api/horario-docente`, `/api/materias-docente`, `/api/alumnos-materia`,
`/api/notas`, `/api/login`, `/api/db-login` · `GET/PUT /api/store`.
