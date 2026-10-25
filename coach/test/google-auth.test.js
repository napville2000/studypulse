import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthUrl, missingScopes, emailFromIdToken, pkcePair, SCOPES } from '../src/google-auth.js';

test('auth URL asks for offline access, consent and PKCE', () => {
  const u = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:5000', scopes: SCOPES.student, state: 's', codeChallenge: 'ch' }));
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.match(u.searchParams.get('prompt'), /consent/);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('scope').includes('classroom.coursework.me.readonly'));
});

test('student scopes are all read-only', () => {
  assert.ok(SCOPES.student.filter(s => s.startsWith('https://')).every(s => s.endsWith('.readonly')));
});

test('missingScopes spots unticked boxes and accepts the email alias', () => {
  const granted = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send';
  assert.deepEqual(missingScopes(SCOPES.parent, granted), ['https://www.googleapis.com/auth/gmail.readonly']);
});

test('emailFromIdToken reads the payload; bad input gives empty string', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'kid@school.org' })).toString('base64url');
  assert.equal(emailFromIdToken(`h.${payload}.sig`), 'kid@school.org');
  assert.equal(emailFromIdToken('garbage'), '');
});

test('pkce challenge differs from verifier', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && challenge && challenge !== verifier);
});
