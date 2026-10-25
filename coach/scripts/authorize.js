#!/usr/bin/env node
// One-time Google sign-in. Saves a refresh token to your private .env so the coach can read
// Classroom (student account) or send the digest (parent account) without asking again.
//
//   npm run authorize:student   ← your daughter signs in with her SCHOOL Google account
//   npm run authorize:parent    ← you sign in with your own Gmail
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { coachHome, ensureHome, loadEnv, saveEnv, envFile } from '../src/config.js';
import { SCOPES, ACCOUNT_KEYS, pkcePair, buildAuthUrl, exchangeCode, missingScopes, emailFromIdToken } from '../src/google-auth.js';
import { apiMessage } from '../src/http.js';

const TIMEOUT_MIN = 5;

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  // A missing opener is reported as an async 'error' event, not a throw. The URL is printed either way.
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log('(Could not open a browser automatically — use the link above.)'));
  child.unref();
}

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:560px;margin:60px auto;line-height:1.5"><h2>${title}</h2><p>${body}</p></body>`;

function waitForCode(server, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `No answer from Google after ${TIMEOUT_MIN} minutes. If the browser showed "Access blocked" or "admin_policy_enforced", ` +
      'her school does not allow outside apps for her account — see SETUP.md "If the school blocks it".')), TIMEOUT_MIN * 60_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404).end(); return; }
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state && !err) { res.writeHead(400).end('State mismatch'); return; }
      clearTimeout(timer);
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Sign-in not completed', `Google said: <b>${err}</b>. You can close this tab.`));
        reject(new Error(err === 'access_denied'
          ? 'Sign-in was cancelled, or the account is not allowed to use this app (if it is her school account, see SETUP.md "If the school blocks it"; otherwise add the account as a test user or publish the app).'
          : `Google returned: ${err}`));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Signed in ✓', 'StudyPulse Coach saved the sign-in. You can close this tab and go back to the terminal.'));
      resolve(code);
    });
  });
}

async function main() {
  const i = process.argv.indexOf('--account');
  const account = process.argv[i + 1];
  if (i < 0 || !SCOPES[account]) {
    console.error('Usage: node scripts/authorize.js --account student|parent');
    process.exit(2);
  }
  const home = ensureHome(coachHome());
  const env = loadEnv(home);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.error(`GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be in ${envFile(home)} first (SETUP.md step 2).`);
    process.exit(1);
  }

  const server = http.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = pkcePair();
  const url = buildAuthUrl({ clientId: env.GOOGLE_CLIENT_ID, redirectUri, scopes: SCOPES[account], state, codeChallenge: challenge });

  const who = account === 'student' ? "your daughter's SCHOOL Google account" : 'YOUR Gmail account';
  console.log(`\nSign in with ${who}.`);
  console.log('Google will warn that the app is unverified: click "Advanced" → "Go to … (unsafe)". It is your own app.');
  console.log('Leave every permission box ticked.\n');
  console.log(`If no browser opens, paste this link into one:\n${url}\n`);
  openBrowser(url);

  try {
    const code = await waitForCode(server, state);
    const tok = await exchangeCode(fetch, { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, code, redirectUri, codeVerifier: verifier });
    if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.');
    const email = emailFromIdToken(tok.id_token);
    const keys = ACCOUNT_KEYS[account];
    const file = saveEnv({ [keys.token]: tok.refresh_token, [keys.email]: email }, home);
    console.log(`✓ Signed in as ${email || '(unknown email)'} — saved to ${file}`);
    const missing = missingScopes(SCOPES[account], tok.scope);
    if (missing.length) {
      console.log(`\n⚠ These permissions were NOT granted:\n  ${missing.join('\n  ')}\nRun this again and leave every box ticked.`);
    }
    if (account === 'student' && email && /@gmail\.com$/i.test(email)) {
      console.log('\n⚠ That is a personal @gmail.com account. Her classes are usually on her SCHOOL account — run this again if so.');
    }
    console.log('\nNext: npm run probe');
  } catch (e) {
    console.error(`\n✗ ${e.body ? apiMessage(e.body) : e.message}`);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

main();
