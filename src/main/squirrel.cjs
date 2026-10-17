'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const APP_ID = 'com.squirrel.voxen-desktop.Voxen';
function handleSquirrel({
  app,
  argv = process.argv,
  platform = process.platform,
  execPath = process.execPath,
  spawnImpl = spawn,
}) {
  const event = argv[1];
  if (
    platform !== 'win32' ||
    ![
      '--squirrel-install',
      '--squirrel-updated',
      '--squirrel-uninstall',
      '--squirrel-obsolete',
    ].includes(event)
  )
    return false;
  if (event === '--squirrel-obsolete') {
    app.quit();
    return true;
  }
  const updater = path.resolve(path.dirname(execPath), '..', 'Update.exe');
  const command = event === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut';
  try {
    const child = spawnImpl(updater, [command, 'Voxen.exe'], { windowsHide: true, shell: false });
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        app.quit();
      }
    };
    const timer = setTimeout(finish, 8000);
    child.once('error', finish);
    child.once('exit', finish);
  } catch {
    app.quit();
  }
  return true;
}
module.exports = { handleSquirrel, APP_ID };
