// Genera build/secrets.json con las credenciales de Warcraft Logs y de Blizzard que ya tienes guardadas (cifradas) en este equipo.
// Ese archivo se empaqueta dentro del programa para que otras personas no tengan que crear sus propias credenciales.
// IMPORTANTE: build/secrets.json está en .gitignore. No lo subas a GitHub ni lo compartas por separado.
// Uso:  npx electron tools/export-secrets.js
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(process.env.APPDATA, 'WipeTime'));
app.whenReady().then(() => {
  const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
  const dec = (s) => {
    if (!s) return '';
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    return s.slice(4);
  };
  const out = {
    wcl: { id: cfg.clientId || '', secret: dec(cfg.clientSecret) },
    bnet: { id: cfg.bnetId || '', secret: dec(cfg.bnetSecret) },
  };
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'secrets.json'), JSON.stringify(out));
  console.log('build/secrets.json creado:', { wcl: !!(out.wcl.id && out.wcl.secret), bnet: !!(out.bnet.id && out.bnet.secret) });
  app.quit();
});
