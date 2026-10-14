# Servidor intermedio de WipeTime

Hace que WipeTime funcione **sin pedir claves a nadie**, como una web: las claves de Warcraft Logs y Blizzard viven aquí (en Vercel, como variables de entorno), no dentro del programa, y nadie puede sacarlas del instalador.

El servidor en producción es `https://wipetime-proxy.vercel.app` y su código está en [`vercel/`](vercel/).

## Puesta en marcha (plan Hobby de Vercel, gratis)

```
cd server/vercel
npx vercel login
npx vercel link --yes --project wipetime-proxy
npx vercel env add WCL_ID production --sensitive      # y lo mismo con WCL_SECRET, BNET_ID, BNET_SECRET
npx vercel deploy --prod --yes
```

Después, `build/proxy.json` debe contener:

```json
{ "url": "https://wipetime-proxy.vercel.app" }
```

y hay que volver a compilar el programa (`npm run dist`).

## Seguridad

- Solo reenvía **lecturas** de datos públicos (consultas de Warcraft Logs sin `mutation` y unas pocas rutas del perfil público de Blizzard).
- Límite de peticiones por minuto y por IP.
- Si algún día se abusa, basta con regenerar las claves en Warcraft Logs / Blizzard y actualizar las variables de entorno en Vercel; la app no hay que tocarla.
- Las claves **propias** que un usuario ponga en Ajustes tienen prioridad sobre el servidor.
