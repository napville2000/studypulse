import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLms, fetchPortal } from '../src/lms-detect.js';
import { fakeFetch } from './helpers.js';

test('detects platforms from URLs, headers and page text', () => {
  assert.equal(detectLms({ urls: ['https://cc.instructure.com/login'] }).id, 'canvas');
  assert.equal(detectLms({ urls: ['https://lms.cc.edu/'], headers: { 'x-canvas-meta': 'a' } }).id, 'canvas');
  assert.equal(detectLms({ urls: ['https://cc.brightspace.com/d2l/login'] }).id, 'd2l');
  assert.equal(detectLms({ urls: ['https://learn.cc.edu/ultra/'] }).id, 'blackboard');
  assert.equal(detectLms({ urls: ['https://elearn.cc.edu/'], body: '<meta name="keywords" content="moodle, Log in">' }).id, 'moodle');
  const sso = detectLms({ urls: ['https://my.cc.edu', 'https://login.microsoftonline.com/x'] });
  assert.equal(sso.id, 'unknown');
  assert.match(sso.evidence, /microsoftonline/);
});

test('fetchPortal follows every redirect hop', async () => {
  const f = fakeFetch([
    ['https://my.cc.edu/', () => ({ status: 302, headers: { location: 'https://cc.instructure.com/login' } })],
    ['https://cc.instructure.com/login', () => ({ text: '<html>log in</html>' })],
  ]);
  const page = await fetchPortal(f, 'https://my.cc.edu/');
  assert.deepEqual(page.urls, ['https://my.cc.edu/', 'https://cc.instructure.com/login']);
  assert.equal(detectLms(page).id, 'canvas');
});
