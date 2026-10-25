import test from 'node:test';
import assert from 'node:assert/strict';
import { runProbe, redact, formatCheck, formatSummary } from '../src/probe.js';
import { SCOPES } from '../src/google-auth.js';
import { fakeFetch } from './helpers.js';

const NOW = new Date('2026-10-25T12:00:00Z');
const ENV = {
  GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec',
  CLASSROOM_REFRESH_TOKEN: 'rt-student', STUDENT_EMAIL: 'kid@school.org',
  GMAIL_REFRESH_TOKEN: 'rt-parent', PARENT_EMAIL: 'parent@gmail.com',
  LMS_PORTAL_URL: 'https://my.cc.edu/', LMS_ICS_URL: 'webcal://cc.edu/feed.ics',
  ANTHROPIC_API_KEY: 'sk-ant-x',
};
const okExec = async () => ({ code: 0, stdout: 'https://github.com/napville2000/studypulse.git\n', stderr: '' });

function googleTokens(studentScopes = SCOPES.student) {
  return ['https://oauth2.googleapis.com/token', (url, opts) => {
    const isStudent = String(opts.body).includes('rt-student');
    return { json: { access_token: isStudent ? 'at-s' : 'at-p', scope: (isStudent ? studentScopes : SCOPES.parent).join(' ') } };
  }];
}

const happyRoutes = () => [
  googleTokens(),
  [/classroom\.googleapis\.com\/v1\/courses\?/, () => ({ json: { courses: [{ id: 'c1', name: 'Chemistry', gradebookSettings: { calculationType: 'WEIGHTED_CATEGORIES' } }, { id: 'c2', name: 'Algebra II' }] } })],
  [/\/courseWork\?/, url => ({ json: { courseWork: [
    { title: 'Ch 8 Quiz', dueDate: { year: 2026, month: 10, day: 30 }, materials: [{ driveFile: { driveFile: { id: url.includes('c1') ? 'doc1' : 'pdf1' } } }] },
    { title: 'Worksheet 3', dueDate: { year: 2026, month: 9, day: 1 } },
  ] } })],
  [/studentSubmissions/, () => ({ json: { studentSubmissions: [
    { state: 'RETURNED', assignedGrade: 7 }, { state: 'CREATED', late: true },
  ] } })],
  [/courseWorkMaterials/, () => ({ json: { courseWorkMaterial: [{ materials: [] }] } })],
  [/\/announcements\?/, () => ({ json: { announcements: [{ text: 'Test on Friday covering chapter 8' }, { text: 'Bring goggles' }] } })],
  [/drive\/v3\/files\/doc1\/export/, () => ({ text: 'Ionic bonds form between...' })],
  [/drive\/v3\/files\/doc1\?/, () => ({ json: { id: 'doc1', name: 'Bonding notes', mimeType: 'application/vnd.google-apps.document' } })],
  [/drive\/v3\/files\/pdf1\?alt=media/, () => ({ text: '%PDF' })],
  [/drive\/v3\/files\/pdf1\?/, () => ({ json: { id: 'pdf1', name: 'Ch 2 packet', mimeType: 'application/pdf' } })],
  ['https://my.cc.edu/', () => ({ status: 302, headers: { location: 'https://cc.instructure.com/login' } })],
  ['https://cc.instructure.com/login', () => ({ text: 'login' })],
  ['https://cc.edu/feed.ics', () => ({ text: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Essay 2\nDTSTART:20261101T235900Z\nEND:VEVENT\nEND:VCALENDAR' })],
  [/gmail\/v1\/users\/me\/messages\?/, () => ({ json: { messages: [{ id: 'm1' }] } })],
  [/gmail\/v1\/users\/me\/messages\/m1/, () => ({ json: { payload: { headers: [{ name: 'Subject', value: 'Daily summary for Kid' }] } } })],
  ['https://api.anthropic.com/v1/models', () => ({ json: { data: [{ id: 'm' }] } })],
];

const byId = (r, id) => r.checks.find(c => c.id === id);

test('happy path: everything readable, nothing written', async () => {
  const f = fakeFetch(happyRoutes());
  const report = await runProbe({ env: ENV, fetch: f, exec: okExec, now: NOW });
  const statuses = Object.fromEntries(report.checks.map(c => [c.id, c.status]));
  assert.deepEqual(statuses, {
    config: 'pass', 'student-signin': 'pass', 'classroom-courses': 'pass', 'classroom-coursework': 'pass',
    'classroom-materials': 'pass', drive: 'pass', 'lms-portal': 'pass', canvas: 'skip', 'lms-ics': 'pass',
    'parent-gmail': 'pass', anthropic: 'pass', 'git-push': 'pass', relay: 'skip',
  });
  const cw = byId(report, 'classroom-coursework').data.totals;
  assert.deepEqual(cw, { assignments: 4, graded: 2, dueNext14Days: 2, lateAndNotTurnedIn: 2 });
  assert.equal(byId(report, 'classroom-materials').data.courses[0].announcementsMentioningTests, 1);
  assert.equal(byId(report, 'drive').data.files[0].textChars, 27);
  assert.equal(byId(report, 'lms-portal').data.platform, 'Canvas');
  assert.equal(report.recommendation.classroom, 'Classroom API');
  assert.equal(report.recommendation.college, 'calendar feed (due dates only; grades from emails)');
  // Read-only: the only POSTs are OAuth token refreshes.
  const posts = f.calls.filter(c => (c.opts.method || 'GET') !== 'GET').map(c => c.url);
  assert.ok(posts.every(u => u === 'https://oauth2.googleapis.com/token'));
});

test('school blocks Classroom: explains Plan B and recommends guardian emails', async () => {
  const routes = happyRoutes();
  routes.splice(1, 0, [/classroom\.googleapis\.com\/v1\/courses\?/, () => ({ status: 403, json: { error: {
    code: 403, message: 'Access to this API is restricted by your domain administrator.', status: 'PERMISSION_DENIED' } } })]);
  const report = await runProbe({ env: ENV, fetch: fakeFetch(routes), exec: okExec, now: NOW });
  const courses = byId(report, 'classroom-courses');
  assert.equal(courses.status, 'fail');
  assert.match(courses.summary, /school/i);
  assert.match(courses.fix, /guardian/);
  assert.equal(byId(report, 'classroom-coursework').status, 'skip');
  assert.equal(report.recommendation.classroom, 'guardian email summaries (Plan B)');
});

test('expired token and disabled API get specific fixes', async () => {
  const expired = await runProbe({ env: ENV, now: NOW, exec: okExec, fetch: fakeFetch([
    ['https://oauth2.googleapis.com/token', () => ({ status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } })],
    ['https://my.cc.edu/', () => ({ text: '' })], ['https://cc.edu/feed.ics', () => ({ text: '' })],
    ['https://api.anthropic.com/', () => ({ json: { data: [] } })],
  ]) });
  assert.match(byId(expired, 'student-signin').fix, /Testing/);

  const routes = happyRoutes();
  routes.splice(1, 0, [/classroom\.googleapis\.com\/v1\/courses\?/, () => ({ status: 403, json: { error: {
    message: 'Google Classroom API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED',
    details: [{ reason: 'SERVICE_DISABLED' }] } } })]);
  const disabled = await runProbe({ env: ENV, fetch: fakeFetch(routes), exec: okExec, now: NOW });
  assert.match(byId(disabled, 'classroom-courses').fix, /Enable the Google Classroom API/);
});

test('unticked permission is a warning; nothing configured is skipped, not failed', async () => {
  const routes = happyRoutes();
  routes[0] = googleTokens(SCOPES.student.filter(s => !s.endsWith('drive.readonly')));
  const report = await runProbe({ env: ENV, fetch: fakeFetch(routes), exec: okExec, now: NOW });
  assert.equal(byId(report, 'student-signin').status, 'warn');

  const bare = await runProbe({ env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' }, fetch: fakeFetch([]), exec: okExec, now: NOW });
  const notSkipped = bare.checks.filter(c => c.status !== 'skip').map(c => c.id);
  assert.deepEqual(notSkipped, ['config', 'git-push']);
});

test('Canvas: token works → grades; bad token → calendar-feed advice', async () => {
  const env = { ...ENV, CANVAS_BASE_URL: 'cc.instructure.com/', CANVAS_TOKEN: 'tok' };
  const canvasRoutes = ok => [
    ['https://cc.instructure.com/api/v1/users/self/todo', () => ({ json: [{}, {}] })],
    ['https://cc.instructure.com/api/v1/users/self', () => ok ? { json: { id: 1 } } : { status: 401, json: { errors: [{ message: 'Invalid access token.' }] } }],
    ['https://cc.instructure.com/api/v1/courses', () => ({ json: [{ name: 'ENG 101', enrollments: [{ computed_current_score: 71.5 }] }, { name: 'HIS 110', enrollments: [{}] }] })],
    ...happyRoutes(),
  ];
  const good = await runProbe({ env, fetch: fakeFetch(canvasRoutes(true)), exec: okExec, now: NOW });
  assert.equal(byId(good, 'canvas').data.coursesWithScore, 1);
  assert.match(good.recommendation.grades, /Canvas/);
  const bad = await runProbe({ env, fetch: fakeFetch(canvasRoutes(false)), exec: okExec, now: NOW });
  assert.match(byId(bad, 'canvas').fix, /LMS_ICS_URL/);
});

test('git push failure is reported with a fix', async () => {
  const exec = async (cmd, args) => args.includes('push')
    ? { code: 128, stdout: '', stderr: 'remote: Permission to napville2000/studypulse.git denied.\nfatal: unable to access' }
    : okExec();
  const report = await runProbe({ env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' }, fetch: fakeFetch([]), exec, now: NOW });
  assert.equal(byId(report, 'git-push').status, 'fail');
  assert.match(byId(report, 'git-push').fix, /Credential Manager/);
});

test('redacted report has no class names, file names, subjects or full emails', async () => {
  const report = await runProbe({ env: ENV, fetch: fakeFetch(happyRoutes()), exec: okExec, now: NOW });
  const text = JSON.stringify(redact(report));
  for (const secret of ['Chemistry', 'Algebra II', 'Bonding notes', 'Daily summary for Kid', 'Essay 2', 'kid@school.org', 'parent@gmail.com']) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  assert.ok(text.includes('k***@school.org'));
  assert.ok(text.includes('"graded":2'));
  // Formatting doesn't throw and shows the per-class breakdown.
  assert.match(report.checks.map(formatCheck).join('\n') + formatSummary(report), /• Chemistry: assignments=2/);
});

test('unreachable portal is a warning and does not print "undefined"', async () => {
  const f = fakeFetch([['https://my.cc.edu/', () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }]]);
  const report = await runProbe({ env: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', LMS_PORTAL_URL: 'https://my.cc.edu/' }, fetch: f, exec: okExec, now: NOW });
  assert.equal(byId(report, 'lms-portal').summary, 'Could not open the portal: fetch failed (ENOTFOUND)');
  assert.equal(report.recommendation.college, 'not configured');
});
