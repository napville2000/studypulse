// Where the coach keeps its private files (secrets, config, data), and .env read/write.
// Everything personal lives here — never inside the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'CLASSROOM_REFRESH_TOKEN', 'STUDENT_EMAIL',
  'GMAIL_REFRESH_TOKEN', 'PARENT_EMAIL',
  'LMS_PORTAL_URL', 'CANVAS_BASE_URL', 'CANVAS_TOKEN', 'LMS_ICS_URL',
  'ANTHROPIC_API_KEY', 'REPO_PATH', 'RELAY_URL',
];

export const COACH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REPO_PATH = path.resolve(COACH_DIR, '..');

export function coachHome(env = process.env, platform = process.platform) {
  if (env.STUDYPULSE_COACH_HOME) return env.STUDYPULSE_COACH_HOME;
  if (platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'StudyPulseCoach');
  return path.join(os.homedir(), '.studypulse-coach');
}

export function ensureHome(home = coachHome()) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

export const envFile = (home = coachHome()) => path.join(home, '.env');

export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// Replace existing KEY= lines in place (keeps comments and order), append keys that are missing.
export function upsertEnv(text, updates) {
  const lines = String(text || '').split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const next = lines.map(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === '') next.pop();
  for (const [k, v] of pending) next.push(`${k}=${v}`);
  return next.join('\n') + '\n';
}

// File values, overridden by real environment variables (so the same code runs in the cloud later).
export function loadEnv(home = coachHome(), env = process.env) {
  const file = envFile(home);
  const fromFile = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  const fromProcess = Object.fromEntries(ENV_KEYS.filter(k => env[k]).map(k => [k, env[k]]));
  return { ...fromFile, ...fromProcess };
}

export function saveEnv(updates, home = coachHome()) {
  ensureHome(home);
  const file = envFile(home);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, upsertEnv(current, updates), { mode: 0o600 });
  return file;
}
