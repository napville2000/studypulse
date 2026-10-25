import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv, upsertEnv, coachHome, loadEnv, saveEnv } from '../src/config.js';

test('parseEnv reads values, strips quotes, ignores comments', () => {
  assert.deepEqual(parseEnv('# c\nA=1\nB = "two words"\r\nC=\'x\'\nbad line\nD='), { A: '1', B: 'two words', C: 'x', D: '' });
});

test('upsertEnv replaces in place, keeps comments, appends new keys', () => {
  const out = upsertEnv('# header\nA=old\nB=keep\n', { A: 'new', Z: 'added' });
  assert.equal(out, '# header\nA=new\nB=keep\nZ=added\n');
});

test('coachHome uses LOCALAPPDATA on Windows and the override when set', () => {
  assert.equal(coachHome({ LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' }, 'win32'), path.join('C:\\Users\\p\\AppData\\Local', 'StudyPulseCoach'));
  assert.equal(coachHome({ STUDYPULSE_COACH_HOME: '/x' }, 'win32'), '/x');
});

test('saveEnv then loadEnv round-trips; real env vars win', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
  saveEnv({ GOOGLE_CLIENT_ID: 'file-id', CANVAS_TOKEN: 't' }, home);
  saveEnv({ CANVAS_TOKEN: 't2' }, home);
  assert.deepEqual(loadEnv(home, {}), { GOOGLE_CLIENT_ID: 'file-id', CANVAS_TOKEN: 't2' });
  assert.equal(loadEnv(home, { GOOGLE_CLIENT_ID: 'env-id' }).GOOGLE_CLIENT_ID, 'env-id');
});
