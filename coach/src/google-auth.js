// Google OAuth for a "Desktop app" client: loopback redirect + PKCE, offline refresh tokens.
import crypto from 'node:crypto';
import { postForm } from './http.js';

const G = 'https://www.googleapis.com/auth/';

// Read-only for the student. The parent account only sends the digest and reads guardian emails.
export const SCOPES = {
  student: [
    'openid', 'email',
    `${G}classroom.courses.readonly`,
    `${G}classroom.coursework.me.readonly`,
    `${G}classroom.courseworkmaterials.readonly`,
    `${G}classroom.announcements.readonly`,
    `${G}classroom.topics.readonly`,
    `${G}drive.readonly`,
  ],
  parent: ['openid', 'email', `${G}gmail.send`, `${G}gmail.readonly`],
};

export const ACCOUNT_KEYS = {
  student: { token: 'CLASSROOM_REFRESH_TOKEN', email: 'STUDENT_EMAIL' },
  parent: { token: 'GMAIL_REFRESH_TOKEN', email: 'PARENT_EMAIL' },
};

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthUrl({ clientId, redirectUri, scopes, state, codeChallenge, loginHint }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account', // always returns a refresh token; lets you pick the right account
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (loginHint) p.set('login_hint', loginHint);
  return `${AUTH_URL}?${p}`;
}

export function exchangeCode(fetchImpl, { clientId, clientSecret, code, redirectUri, codeVerifier }) {
  return postForm(fetchImpl, TOKEN_URL, {
    client_id: clientId, client_secret: clientSecret, code,
    redirect_uri: redirectUri, code_verifier: codeVerifier, grant_type: 'authorization_code',
  });
}

export function refreshAccessToken(fetchImpl, { clientId, clientSecret, refreshToken }) {
  return postForm(fetchImpl, TOKEN_URL, {
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  });
}

// Google's consent screen lets people untick individual permissions, so check what was granted.
export function missingScopes(requested, grantedScopeString) {
  const granted = new Set(String(grantedScopeString || '').split(/\s+/));
  const alias = { email: `${G}userinfo.email` };
  return requested.filter(s => !granted.has(s) && !granted.has(alias[s]));
}

// The id_token comes straight from Google's token endpoint over TLS, so reading it without
// signature verification is fine for showing which account signed in.
export function emailFromIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || '';
  } catch {
    return '';
  }
}
