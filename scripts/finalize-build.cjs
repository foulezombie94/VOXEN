const fs = require('node:fs'),
  path = require('node:path');
const out = path.join(__dirname, '../dist/renderer');
fs.writeFileSync(
  path.join(out, 'index.html'),
  "<!doctype html><html lang=\"fr\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self';\"><title>Voxen</title></head><body><div id=\"root\"></div><script src=\"app.js\"></script></body></html>",
);
fs.copyFileSync(
  path.join(__dirname, '../src/renderer/recorder-worklet.js'),
  path.join(out, 'recorder-worklet.js'),
);
