# WipeTime

Programa de Windows para **ver, analizar y comparar logs de World of Warcraft** a partir de un enlace público de [Warcraft Logs](https://www.warcraftlogs.com). Hecho por Drakko · sr.kitkat ♥ · España 🇪🇸

## Web

Usa WipeTime directamente en el navegador, sin instalar nada:

**[https://kingkhaax.github.io/WipeTime/](https://kingkhaax.github.io/WipeTime/)**

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

## Descarga

Descarga la última versión desde [Releases](https://github.com/KingKhaax/WipeTime/releases/latest):

- `WipeTime vX.Y.Z Setup.exe`: instalador (se desinstala desde *Configuración → Aplicaciones* de Windows).
- `WipeTime vX.Y.Z.exe`: versión portable, no necesita instalación.
- `latest.json`: versión y hashes SHA-256 (los usa el actualizador del programa).

Los ejecutables están firmados digitalmente (ver [Code signing policy](#code-signing-policy)).

## Para desarrollar

```
npm install
npm start         # abrir en desarrollo
npm run dist      # generar los instaladores en dist/
```

Las releases oficiales se compilan y firman en GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- Committers and reviewers: [KingKhaax](https://github.com/KingKhaax)
- Approvers: [KingKhaax](https://github.com/KingKhaax)

Release binaries are built from this repository's source code by GitHub Actions and every signing request is approved manually.

## Privacy policy

WipeTime does not collect telemetry and has no user accounts of its own. Settings, API keys you enter and the Battle.net login token are stored only on your computer (encrypted with Windows when available). To work, it makes these requests:

| Service | When | What is sent |
|---|---|---|
| [Warcraft Logs](https://www.warcraftlogs.com/) | When you load a log or rankings | The report code and the data queried |
| WipeTime proxy (`wipetime-proxy.vercel.app`, run by the WipeTime developer on [Vercel](https://vercel.com/)) | When you haven't entered your own API keys | Forwards read-only Warcraft Logs and Blizzard queries (report codes, character/guild names). Nothing is stored; Vercel may keep standard request logs (IP address, time). |
| [Blizzard Battle.net](https://www.blizzard.com/) | Only if you choose to log in, or look up characters/guilds | Login happens on Blizzard's own page; WipeTime receives your BattleTag and a read-only `wow.profile` token |
| [Raider.IO](https://raider.io/) | When you search characters/guilds or view Mythic+ rankings | The names searched |
| [Wowhead](https://www.wowhead.com/), [Raidbots](https://www.raidbots.com/), assets.rpglogs.com, cdn.raidplan.io | When spells, talents, icons or boss maps are shown | Spell IDs and image requests |
| [GitHub Pages](https://pages.github.com/) | Only if you use the web version | Serves the page; your settings, chosen character and uploaded maps stay in your browser (localStorage/IndexedDB) |
| [GitHub](https://github.com/) | At startup and when you click update; first run downloads an icon pack | Checks for a new version and downloads updates |

Only the request itself and your IP address reach these services. Their privacy policies: [Warcraft Logs](https://www.warcraftlogs.com/) (linked in its site footer), [Vercel](https://vercel.com/legal/privacy-policy), [Blizzard](https://www.blizzard.com/legal/a4380ee5-5c8d-4e3b-83b7-ea26d01a9918/blizzard-entertainment-online-privacy-policy), [Raider.IO](https://raider.io/privacy-policy), [Wowhead](https://www.wowhead.com/privacy), [Raidbots](https://www.raidbots.com/privacy), [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## License

[MIT](LICENSE)
