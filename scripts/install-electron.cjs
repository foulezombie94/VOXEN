'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Electron's pinned npm package ships its installer separately from the binary.
const installer = path.resolve(__dirname, '../node_modules/electron/install.js');
if (fs.existsSync(installer)) {
  const result = spawnSync(process.execPath, [installer], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
