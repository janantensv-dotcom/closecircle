# Chat Verde

Frontend de chat hecho con React + Vite + Supabase. Incluye registro/login, chats privados, creación de grupos, mensajes en tiempo real y adjuntos en almacenamiento privado (máximo 10 MB por archivo).

## Requisitos
- Node.js LTS: https://nodejs.org/
- Cuenta de Supabase: https://supabase.com/
- Git para subirlo a GitHub (opcional para probar en local).

## 1. Configurar Supabase
1. Crea un proyecto nuevo en https://supabase.com/dashboard.
2. En el proyecto, abre **SQL Editor** y crea una consulta nueva.
3. Abre `supabase.sql` de esta carpeta, copia todo y pégalo en SQL Editor. Pulsa **Run**. Este SQL está preparado para una instalación nueva.
4. En Supabase, abre **Project Settings / API** o **Connect** y copia la Project URL y la publishable key (normalmente empieza por `sb_publishable_`). No uses `service_role` ni una secret key en el navegador.
5. En Supabase > **Authentication > URL Configuration**, para desarrollo añade `http://localhost:5173` como Site URL y Redirect URL. En producción añade también el dominio de la web publicada.
6. Si está activada la confirmación por email, confirma los correos de las cuentas de prueba antes de iniciar sesión.

> Si ya ejecutaste el SQL de una versión antigua de Chat Verde, no pegues este script a ciegas sobre la base de datos antigua: la estructura de `messages` ha cambiado. Lo más sencillo para un proyecto de pruebas sin datos es crear un proyecto Supabase nuevo y ejecutar este SQL desde cero. Si ya tienes datos importantes, prepara una migración antes.

## 2. Configurar el frontend
1. Abre esta carpeta en Visual Studio Code.
2. Crea un archivo `.env.local` en la raíz, junto a `package.json`.
3. Pon tus valores reales:

```dotenv
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
```

4. Abre una terminal en esta carpeta y ejecuta:

```bash
npm install
npm run dev
```

5. Abre la dirección que muestre Vite, normalmente http://localhost:5173.

## 3. Probarlo
1. Registra dos cuentas distintas y confirma los correos si Supabase lo requiere.
2. Entra con la primera cuenta y abre un chat privado con la segunda.
3. Usa el botón `+` de la lista de conversaciones para crear un grupo y seleccionar participantes.
4. Usa el clip junto al cuadro de texto para adjuntar archivos. El límite de la app es 10 MB por archivo. Los archivos se guardan en el bucket privado `chat-files` y se muestran con enlaces temporales.
5. Para probar Realtime, abre dos sesiones diferentes en dos navegadores.

## 4. Subirlo a GitHub
Crea un repositorio vacío en GitHub, abre una terminal dentro de esta carpeta y ejecuta (cambia la URL por la de tu repositorio):

```bash
git init
git add .
git commit -m "Chat Verde con grupos y archivos"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/chat-verde.git
git push -u origin main
```

`.env.local` está ignorado por Git. Comprueba siempre que no subes claves secretas. La URL y la publishable key están diseñadas para usarse en frontend, pero las tablas y el bucket dependen de las políticas RLS incluidas en `supabase.sql`.

## Archivos principales
- `src/App.jsx`: registro, login, contactos, grupos, mensajes y archivos.
- `src/style.css`: interfaz y estilos adaptables.
- `supabase.sql`: tablas, políticas de seguridad, bucket privado y Realtime.
- `.env.example`: plantilla de variables; copia sus valores a `.env.local` y sustitúyelos.

## Límites de esta versión
No incluye llamadas, mensajes de voz, edición/borrado, recuperación de contraseña ni cifrado de extremo a extremo. No es una aplicación auditada para producción. Antes de abrirla al público, añade límites contra spam, controles de abuso y pruebas de seguridad.
