# WipeTime

Programa de Windows para **ver, analizar y comparar logs de World of Warcraft** a partir de un enlace público de [Warcraft Logs](https://www.warcraftlogs.com). Hecho por Drakko · sr.kitkat ♥ · España 🇪🇸

## Qué hace

- **Clasificaciones:** ranking de parses por rol (DPS, tanques y sanadores) de un intento, varios pulls o todos los intentos del jefe, con filtros por clase y orden.
- **Informe general y Resumen:** top de la noche, equipo, talentos, encantamientos y consumibles de cada jugador.
- **Daño, sanación, muertes, defensivos, buffos, prepoti y piedra de salud.**
- **Mecánicas:** guía de cada jefe con iconos y dificultades, y análisis del daño evitable.
- **Replay** de la pelea con zoom, buffos y debuffos (solo raids).
- **Mítica+:** pulls, ruta y comparación con los mejores de tu nivel de llave.
- **Comparar logs**, con consejos específicos para sanadores (maná) y tanques (mitigación).
- **Guilds:** ranking de la guild y de sus miembros; al pulsar uno de tus personajes se despliega su armería (equipo y estadísticas en número y %).
- **Buscar personaje:** escribe el nombre (reino opcional) y elige entre los personajes que existen, con su reino y bandera; la ficha al estilo WoWProgress muestra posiciones, tabla por jefe, equipo y modelo en vivo.
- **Idiomas:** español, inglés, alemán y francés desde el botón «Idiomas».

## Cómo usarlo

1. Instala `WipeTime vX.Y.Z Setup.exe` (o abre la versión portable `WipeTime vX.Y.Z.exe`).
2. Pega el enlace de un log de Warcraft Logs y pulsa **Cargar**.
3. Elige tu personaje cuando te lo pida y navega por las pestañas.

> La primera vez puede pedir claves de la API de Warcraft Logs (Ajustes → Cuenta de Warcraft Logs). Si el programa trae el servidor intermedio (carpeta `server/`), no pide nada.

## Para desarrollar

```
npm install
npm start         # abrir en desarrollo
npm run dist      # generar los instaladores en dist/
```
