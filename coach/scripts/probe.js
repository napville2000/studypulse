#!/usr/bin/env node
// Phase 0 access test: checks what the coach can see on each site. Read-only — it changes nothing.
//   npm run probe
// Writes two files to your private coach folder:
//   probe-report.json           full detail (class names etc.) — keep private
//   probe-report.redacted.json  same, without names/titles/emails — safe to share with Claude
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { coachHome, ensureHome, loadEnv, envFile } from '../src/config.js';
import { runProbe, redact, formatCheck, formatSummary } from '../src/probe.js';

function exec(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr || err?.message || '') });
    });
  });
}

const home = ensureHome(coachHome());
console.log(`StudyPulse Coach — access test (read-only)\nSettings: ${envFile(home)}\n`);

const report = await runProbe({
  env: loadEnv(home), envPath: envFile(home), fetch, exec,
  onCheck: c => console.log(formatCheck(c)),
});
console.log(formatSummary(report));

const full = path.join(home, 'probe-report.json');
const shareable = path.join(home, 'probe-report.redacted.json');
fs.writeFileSync(full, JSON.stringify(report, null, 2));
fs.writeFileSync(shareable, JSON.stringify(redact(report), null, 2));
console.log(`\nSaved:\n  ${full}  (private)\n  ${shareable}  (safe to share)`);
