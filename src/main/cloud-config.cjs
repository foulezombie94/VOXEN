'use strict';
const fs = require('node:fs');
const path = require('node:path');
function readClientConfig(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = new URL(value.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publishableKey || '')
    )
      return null;
    return {
      url: url.origin,
      publishableKey: value.publishableKey,
      projectName: String(value.projectName || 'Voxen').slice(0, 80),
    };
  } catch {
    return null;
  }
}
function loadClientConfig(directory, bundled) {
  return (
    readClientConfig(path.join(directory, 'cloud-config.json')) || readClientConfig(bundled) || {}
  );
}
module.exports = { readClientConfig, loadClientConfig };
