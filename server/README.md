# Servidor intermedio de WipeTime

Hace que WipeTime funcione **sin pedir claves a nadie**, como una web: las claves de Warcraft Logs y Blizzard viven aquí (en Cloudflare), no dentro del programa, y nadie puede sacarlas del instalador.

## Puesta en marcha (una sola vez, gratis)

1. Crea una cuenta gratuita en <https://dash.cloudflare.com>.
2. En una terminal, dentro de la carpeta `server/`:
   ```
   npm i -g wrangler
   wrangler login
   wrangler deploy worker.js --name wipetime-proxy --compatibility-date 2025-01-01
   wrangler secret put WCL_ID --name wipetime-proxy
   wrangler secret put WCL_SECRET --name wipetime-proxy
   wrangler secret put BNET_ID --name wipetime-proxy
   wrangler secret put BNET_SECRET --name wipetime-proxy
   ```
   (Cada `secret put` te pide el valor y lo guarda cifrado; no queda en ningún archivo.)
3. Wrangler te da una dirección tipo `https://wipetime-proxy.TU-USUARIO.workers.dev`. Crea el archivo `build/proxy.json` con:
   ```json
   { "url": "https://wipetime-proxy.TU-USUARIO.workers.dev" }
   ```
   y vuelve a compilar el programa (`npm run dist`). La app lo incluye y ya no pide credenciales.

## Seguridad

- Solo reenvía **lecturas** de datos públicos (consultas de Warcraft Logs sin `mutation` y unas pocas rutas del perfil público de Blizzard).
- Límite de 120 peticiones por minuto y por IP; para algo más estricto, añade una regla de *Rate Limiting* en el panel de Cloudflare.
- Si algún día se abusa, basta con regenerar las claves en Warcraft Logs / Blizzard y volver a ejecutar los `secret put`; la app no hay que tocarla.
- Las claves **propias** que un usuario ponga en Ajustes tienen prioridad sobre el servidor.
