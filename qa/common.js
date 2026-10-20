// Shared helpers for the QA scripts. No secrets live in this folder: logins come from the environment.
const fs = require('fs');
const path = require('path');

function chromiumPath() {
  if (process.env.QA_CHROMIUM) return process.env.QA_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort();
  if (!dirs.length) throw new Error(`no chromium under ${root}`);
  return path.join(root, dirs[dirs.length - 1], 'chrome-linux', 'chrome');
}

const PROD = 'https://www.neo-fm.com';
const base = (process.env.QA_BASE || PROD).replace(/\/$/, '');

module.exports = { chromiumPath, base, PROD };
