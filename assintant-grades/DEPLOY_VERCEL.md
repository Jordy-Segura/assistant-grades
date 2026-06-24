# Deploy en Vercel con Neon

La aplicacion esta preparada para desplegarse desde esta carpeta (`assintant-grades`).

## Variables de entorno

Configure estas variables en Vercel antes de desplegar:

```env
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://...neon.tech/neondb?sslmode=require
OASIS_BASE=http://swoasis.espoch.edu.ec/OASis/OAS_Interop
OASIS_USER=usuario_servicio_oasis
OASIS_PASS=clave_servicio_oasis
CORS_ORIGIN=*
```

Use `DATABASE_URL` de Neon para runtime. Si Vercel instala la integracion de Neon, esa variable se inyecta automaticamente.

## Comandos

```bash
npm install
npm run db:setup
npm run build
npx vercel
```

Para produccion, use `npx vercel --prod` cuando el preview ya este validado.

El frontend en produccion llama la API del mismo dominio (`/api/...`), por eso no necesita `VITE_API_BASE_URL` en Vercel.
