'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') {
  console.error('Le diagnostic UI nécessite Windows.');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'voxen-ui-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.env.VOXEN_TEST_EXE || require('electron');
const args = process.env.VOXEN_TEST_EXE ? [] : [root];
const result = spawnSync(executable, [...args, '--ui-self-test', output], {
  cwd: root,
  env,
  stdio: 'ignore',
  timeout: 60000,
});
const destination = path.join(root, 'artifacts/ui');
fs.mkdirSync(destination, { recursive: true });
for (const name of fs.readdirSync(output)) {
  if (name.endsWith('.png') || /^electron-ui-(validation|error)\.json$/.test(name))
    fs.copyFileSync(path.join(output, name), path.join(destination, name));
}
const report = path.join(output, 'electron-ui-validation.json');
if (result.error || result.status !== 0 || !fs.existsSync(report)) {
  const failure = path.join(output, 'electron-ui-error.json');
  const detail = fs.existsSync(failure) ? JSON.parse(fs.readFileSync(failure, 'utf8')) : {};
  console.error(
    JSON.stringify({
      exitCode: result.status,
      signal: result.signal,
      runnerError: result.error?.code,
      error: detail.error,
      detail: detail.detail,
    }),
  );
  console.error('Diagnostic UI échoué. Voir artifacts/ui.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(report, 'utf8'));
console.log(
  JSON.stringify(
    {
      passed: true,
      accountMenu: data.accountMenu,
      settingsTabs: data.settingsTabs.length,
      guides: data.guides.length,
      popupHiddenOnStartup: data.popupHiddenOnStartup,
      networkRequests: data.networkRequests,
    },
    null,
    2,
  ),
);
