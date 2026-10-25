// Phase 0 access tests. Every call here is read-only: it lists and reads, never writes,
// so it is safe to run as often as needed. The result decides which data sources the coach uses.
import { getJson, getText, HttpError, apiMessage, apiReasons } from './http.js';
import { refreshAccessToken, missingScopes, SCOPES } from './google-auth.js';
import { parseIcs, icsUrl } from './ics.js';
import { detectLms, fetchPortal, NEXT_STEPS } from './lms-detect.js';
import { DEFAULT_REPO_PATH, ENV_KEYS } from './config.js';

const CLASSROOM = 'https://classroom.googleapis.com/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const ASSESSMENT = /\b(test|quiz|exam|midterm|final|assessment|unit check)\b/i;
const DAY = 86_400_000;

const result = (id, label, status, summary, data = {}, fix = '') => ({ id, label, status, summary, data, ...(fix && { fix }) });
const skip = (id, label, why) => result(id, label, 'skip', why);
// Node's fetch reports network problems as a bare "fetch failed"; the useful part is in .cause
const netError = e => (e.cause?.code ? `${e.message} (${e.cause.code})` : e.message);

function explainGoogle(e, api) {
  if (!(e instanceof HttpError)) return { summary: e.message };
  const msg = apiMessage(e.body);
  const reasons = apiReasons(e.body).join(' ');
  if (e.body?.error === 'invalid_grant') return {
    summary: 'The saved sign-in no longer works (expired or revoked).',
    fix: 'If the OAuth consent screen is still in "Testing", tokens expire after 7 days. Publish it (SETUP.md step 2), then run the authorize step again.',
  };
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(reasons + ' ' + msg)) return {
    summary: `The ${api} is not turned on in your Google Cloud project.`,
    fix: `Enable the ${api} (SETUP.md step 2), wait a minute, and run the probe again.`,
  };
  if (/admin|policy|domain|organization/i.test(msg + ' ' + reasons)) return {
    summary: `Her school's Google admin blocks this: ${msg}`,
    fix: 'Plan B is the Classroom guardian email summaries (run authorize:parent). Plan C is asking school IT to allow your OAuth client ID.',
  };
  if (e.status === 401) return { summary: 'Google rejected the access token.', fix: 'Run the authorize step again.' };
  if (e.status === 403) return { summary: `Permission denied: ${msg}`, fix: 'Run the authorize step again and leave every permission box ticked.' };
  return { summary: msg || e.message };
}

async function googleToken(ctx, refreshToken) {
  return refreshAccessToken(ctx.fetch, {
    clientId: ctx.env.GOOGLE_CLIENT_ID, clientSecret: ctx.env.GOOGLE_CLIENT_SECRET, refreshToken,
  });
}

async function listAll(ctx, url, key, token, maxPages = 5) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < maxPages; i++) {
    const u = new URL(url);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const page = await getJson(ctx.fetch, u.toString(), { Authorization: `Bearer ${token}` });
    out.push(...(page[key] || []));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const dueDateOf = cw => cw.dueDate
  ? new Date(Date.UTC(cw.dueDate.year, cw.dueDate.month - 1, cw.dueDate.day, cw.dueTime?.hours ?? 23, cw.dueTime?.minutes ?? 59))
  : null;

function driveIdsFrom(materials = []) {
  return materials.map(m => m.driveFile?.driveFile?.id).filter(Boolean);
}

// ── Checks ──────────────────────────────────────────────────────────

function checkConfig(ctx) {
  const present = ENV_KEYS.filter(k => ctx.env[k]);
  const missing = ENV_KEYS.filter(k => !ctx.env[k]);
  if (!ctx.env.GOOGLE_CLIENT_ID || !ctx.env.GOOGLE_CLIENT_SECRET) {
    return result('config', 'Settings file', 'fail', 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.', { present, missing },
      `Add them to ${ctx.envPath} (SETUP.md step 2).`);
  }
  return result('config', 'Settings file', 'pass', `${present.length} settings found.`, { present, missing });
}

async function checkStudentSignIn(ctx, state) {
  const label = 'Student Google sign-in';
  if (!ctx.env.CLASSROOM_REFRESH_TOKEN) return result('student-signin', label, 'skip', 'Not signed in yet.', {}, 'Run: npm run authorize:student (with your daughter signing in).');
  try {
    const tok = await googleToken(ctx, ctx.env.CLASSROOM_REFRESH_TOKEN);
    state.studentToken = tok.access_token;
    const missing = missingScopes(SCOPES.student, tok.scope);
    const data = { email: ctx.env.STUDENT_EMAIL || '', missingScopes: missing };
    if (missing.length) return result('student-signin', label, 'warn', `Signed in, but ${missing.length} permission(s) were not granted.`, data,
      'Run npm run authorize:student again and leave every box ticked.');
    return result('student-signin', label, 'pass', `Signed in${data.email ? ' as ' + data.email : ''}.`, data);
  } catch (e) {
    const x = explainGoogle(e, 'Google sign-in');
    return result('student-signin', label, 'fail', x.summary, {}, x.fix);
  }
}

async function checkCourses(ctx, state) {
  const label = 'Classroom: courses';
  if (!state.studentToken) return skip('classroom-courses', label, 'Needs the student sign-in.');
  try {
    const courses = await listAll(ctx, `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=50`, 'courses', state.studentToken);
    state.courses = courses;
    const data = {
      count: courses.length,
      courses: courses.map(c => ({ name: c.name, gradebook: c.gradebookSettings?.calculationType || null })),
    };
    if (!courses.length) return result('classroom-courses', label, 'warn', 'No active classes on this account.', data,
      'Check that she signed in with her SCHOOL Google account, then run authorize:student again.');
    return result('classroom-courses', label, 'pass', `${courses.length} active class(es).`, data);
  } catch (e) {
    const x = explainGoogle(e, 'Google Classroom API');
    return result('classroom-courses', label, 'fail', x.summary, {}, x.fix);
  }
}

async function checkCoursework(ctx, state) {
  const label = 'Classroom: assignments & grades';
  if (!state.courses?.length) return skip('classroom-coursework', label, 'No classes to look at.');
  const now = ctx.now.getTime();
  const perCourse = [];
  const errors = [];
  for (const c of state.courses.slice(0, ctx.maxCourses)) {
    try {
      const auth = state.studentToken;
      const work = await listAll(ctx, `${CLASSROOM}/courses/${c.id}/courseWork?pageSize=50`, 'courseWork', auth, 2);
      const subs = await listAll(ctx, `${CLASSROOM}/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`, 'studentSubmissions', auth, 2);
      work.forEach(w => state.driveFiles.push(...driveIdsFrom(w.materials)));
      const dues = work.map(dueDateOf).filter(Boolean);
      perCourse.push({
        name: c.name,
        assignments: work.length,
        withDueDate: dues.length,
        dueNext14Days: dues.filter(d => d >= now && d - now <= 14 * DAY).length,
        looksLikeTestOrQuiz: work.filter(w => ASSESSMENT.test(w.title || '')).length,
        submissions: subs.length,
        graded: subs.filter(s => s.assignedGrade != null).length,
        returned: subs.filter(s => s.state === 'RETURNED').length,
        late: subs.filter(s => s.late).length,
        lateAndNotTurnedIn: subs.filter(s => s.late && !['TURNED_IN', 'RETURNED'].includes(s.state)).length,
      });
    } catch (e) {
      errors.push({ name: c.name, error: explainGoogle(e, 'Google Classroom API').summary });
    }
  }
  const sum = k => perCourse.reduce((a, c) => a + c[k], 0);
  const totals = { assignments: sum('assignments'), graded: sum('graded'), dueNext14Days: sum('dueNext14Days'), lateAndNotTurnedIn: sum('lateAndNotTurnedIn') };
  const data = { totals, courses: perCourse, errors };
  if (!perCourse.length) return result('classroom-coursework', label, 'fail', `Could not read assignments: ${errors[0]?.error}`, data,
    'Run authorize:student again and leave every box ticked.');
  const summary = `${totals.assignments} assignments, ${totals.graded} with a grade visible, ${totals.dueNext14Days} due in the next 2 weeks.`;
  if (!totals.graded) return result('classroom-coursework', label, 'warn', summary + ' No grades visible.', data,
    'Either nothing is graded yet, or teachers keep grades in another gradebook. We will rely on the college portal / report cards for grades.');
  return result('classroom-coursework', label, errors.length ? 'warn' : 'pass', summary, data);
}

async function checkMaterialsAndAnnouncements(ctx, state) {
  const label = 'Classroom: class materials & announcements';
  if (!state.courses?.length) return skip('classroom-materials', label, 'No classes to look at.');
  const perCourse = [];
  const errors = [];
  for (const c of state.courses.slice(0, ctx.maxCourses)) {
    const row = { name: c.name, materials: null, announcements: null, announcementsMentioningTests: null };
    try {
      const mats = await listAll(ctx, `${CLASSROOM}/courses/${c.id}/courseWorkMaterials?pageSize=20`, 'courseWorkMaterial', state.studentToken, 1);
      mats.forEach(m => state.driveFiles.push(...driveIdsFrom(m.materials)));
      row.materials = mats.length;
    } catch (e) { errors.push({ name: c.name, what: 'materials', error: explainGoogle(e, 'Google Classroom API').summary }); }
    try {
      const anns = await listAll(ctx, `${CLASSROOM}/courses/${c.id}/announcements?pageSize=20`, 'announcements', state.studentToken, 1);
      row.announcements = anns.length;
      row.announcementsMentioningTests = anns.filter(a => ASSESSMENT.test(a.text || '')).length;
    } catch (e) { errors.push({ name: c.name, what: 'announcements', error: explainGoogle(e, 'Google Classroom API').summary }); }
    perCourse.push(row);
  }
  const mats = perCourse.reduce((a, c) => a + (c.materials || 0), 0);
  const anns = perCourse.reduce((a, c) => a + (c.announcements || 0), 0);
  const data = { courses: perCourse, errors };
  const summary = `${mats} material posts, ${anns} recent announcements.`;
  if (errors.length && !mats && !anns) return result('classroom-materials', label, 'fail', `${summary} ${errors[0].error}`, data,
    'Run authorize:student again and leave every box ticked.');
  return result('classroom-materials', label, errors.length ? 'warn' : 'pass', summary, data);
}

async function checkDrive(ctx, state) {
  const label = 'Drive: read teacher files';
  const ids = [...new Set(state.driveFiles)].slice(0, 3);
  if (!ids.length) return skip('drive', label, 'No attached Drive files found to test with.');
  const files = [];
  for (const id of ids) {
    const auth = { Authorization: `Bearer ${state.studentToken}` };
    try {
      const meta = await getJson(ctx.fetch, `${DRIVE}/files/${id}?fields=id,name,mimeType&supportsAllDrives=true`, auth);
      let chars = null;
      if (/^application\/vnd\.google-apps\.(document|presentation)$/.test(meta.mimeType)) {
        chars = (await getText(ctx.fetch, `${DRIVE}/files/${id}/export?mimeType=text/plain`, auth)).length;
      } else if (!meta.mimeType.startsWith('application/vnd.google-apps.')) {
        await getText(ctx.fetch, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { ...auth, Range: 'bytes=0-2047' });
      }
      files.push({ name: meta.name, type: meta.mimeType, readable: true, ...(chars != null && { textChars: chars }) });
    } catch (e) {
      files.push({ readable: false, error: explainGoogle(e, 'Google Drive API').summary });
    }
  }
  const ok = files.filter(f => f.readable).length;
  const data = { tested: files.length, readable: ok, files };
  if (!ok) return result('drive', label, 'fail', `Could not open any of ${files.length} attached files: ${files[0].error}`, data,
    'If the Drive API is off, enable it (SETUP.md step 2). Otherwise the school restricts file access, and we will build study material from assignment text and her notes instead.');
  return result('drive', label, ok === files.length ? 'pass' : 'warn', `Read ${ok} of ${files.length} attached files.`, data);
}

async function checkPortal(ctx, state) {
  const label = 'College portal: which system';
  if (!ctx.env.LMS_PORTAL_URL) return result('lms-portal', label, 'skip', 'LMS_PORTAL_URL is not set.', {}, 'Add the college portal address to .env as LMS_PORTAL_URL.');
  try {
    const page = await fetchPortal(ctx.fetch, ctx.env.LMS_PORTAL_URL);
    const lms = detectLms(page);
    state.lms = lms.id;
    const data = { platform: lms.name, evidence: lms.evidence, hosts: [...new Set(page.urls.map(u => new URL(u).host))] };
    return result('lms-portal', label, lms.id === 'unknown' ? 'warn' : 'pass', `Looks like ${lms.name} (${lms.evidence}).`, data, NEXT_STEPS[lms.id]);
  } catch (e) {
    return result('lms-portal', label, 'warn', `Could not open the portal: ${netError(e)}`, {}, 'Check LMS_PORTAL_URL is the address you type to log in.');
  }
}

async function checkCanvas(ctx) {
  const label = 'College portal: Canvas API';
  const { CANVAS_BASE_URL: base0, CANVAS_TOKEN: token } = ctx.env;
  if (!base0 || !token) return skip('canvas', label, 'No Canvas token set (only needed if the portal is Canvas).');
  const base = (/^https?:\/\//.test(base0) ? base0 : `https://${base0}`).replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${token}` };
  try {
    await getJson(ctx.fetch, `${base}/api/v1/users/self`, auth);
    const courses = await getJson(ctx.fetch, `${base}/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=50`, auth);
    const todo = await getJson(ctx.fetch, `${base}/api/v1/users/self/todo?per_page=50`, auth);
    const withScore = courses.filter(c => (c.enrollments || []).some(e => e.computed_current_score != null)).length;
    const data = {
      courses: courses.map(c => ({ name: c.name, hasCurrentScore: (c.enrollments || []).some(e => e.computed_current_score != null) })),
      coursesWithScore: withScore, todoItems: todo.length,
    };
    return result('canvas', label, 'pass', `${courses.length} course(s), ${withScore} with a current grade, ${todo.length} to-do item(s).`, data);
  } catch (e) {
    const fix = e.status === 401
      ? 'The token is wrong, expired, or the college disables student tokens. Use the Canvas calendar feed instead (LMS_ICS_URL).'
      : 'Check CANVAS_BASE_URL is just the address, like https://college.instructure.com';
    return result('canvas', label, 'fail', e.message, {}, fix);
  }
}

async function checkIcs(ctx) {
  const label = 'College portal: calendar feed';
  if (!ctx.env.LMS_ICS_URL) return skip('lms-ics', label, 'No calendar feed URL set.');
  try {
    const events = parseIcs(await getText(ctx.fetch, icsUrl(ctx.env.LMS_ICS_URL)));
    const now = ctx.now.getTime();
    const upcoming = events.filter(e => e.when && e.when >= now && e.when - now <= 30 * DAY).sort((a, b) => a.when - b.when);
    const data = { events: events.length, next30Days: upcoming.length, samples: upcoming.slice(0, 5).map(e => e.summary) };
    if (!events.length) return result('lms-ics', label, 'warn', 'The feed opened but has no events.', data, 'Make sure it is her personal calendar feed, not a blank public one.');
    return result('lms-ics', label, 'pass', `${events.length} events, ${upcoming.length} in the next 30 days.`, data);
  } catch (e) {
    return result('lms-ics', label, 'fail', e.message, {}, 'Copy the feed URL again; some portals regenerate it.');
  }
}

async function checkParentGmail(ctx) {
  const label = 'Parent Gmail: digest + guardian emails';
  if (!ctx.env.GMAIL_REFRESH_TOKEN) return result('parent-gmail', label, 'skip', 'Not signed in yet.', {}, 'Run: npm run authorize:parent (with your own Gmail).');
  try {
    const tok = await googleToken(ctx, ctx.env.GMAIL_REFRESH_TOKEN);
    const missing = missingScopes(SCOPES.parent, tok.scope);
    const auth = { Authorization: `Bearer ${tok.access_token}` };
    const q = encodeURIComponent('from:classroom.google.com newer_than:30d');
    const list = await getJson(ctx.fetch, `${GMAIL}/messages?q=${q}&maxResults=25`, auth);
    const subjects = [];
    for (const m of (list.messages || []).slice(0, 5)) {
      const msg = await getJson(ctx.fetch, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=Subject`, auth);
      subjects.push((msg.payload?.headers || []).find(h => h.name === 'Subject')?.value || '');
    }
    const data = {
      email: ctx.env.PARENT_EMAIL || '', canSend: !missing.some(s => s.endsWith('gmail.send')),
      classroomEmails30d: (list.messages || []).length, guardianSummaries: subjects.filter(s => /summary|guardian/i.test(s)).length,
      subjects, missingScopes: missing,
    };
    const summary = `${data.canSend ? 'Can send the digest' : 'CANNOT send the digest'}; ${data.classroomEmails30d} Classroom email(s) in the last 30 days.`;
    if (!data.canSend) return result('parent-gmail', label, 'warn', summary, data, 'Run npm run authorize:parent again and leave every box ticked.');
    if (!data.classroomEmails30d) return result('parent-gmail', label, 'warn', summary, data,
      'Optional backup source: ask her teachers to add you as a guardian in Classroom and choose daily email summaries.');
    return result('parent-gmail', label, 'pass', summary, data);
  } catch (e) {
    const x = explainGoogle(e, 'Gmail API');
    return result('parent-gmail', label, 'fail', x.summary, {}, x.fix);
  }
}

async function checkAnthropic(ctx) {
  const label = 'Anthropic API key';
  if (!ctx.env.ANTHROPIC_API_KEY) return result('anthropic', label, 'skip', 'Not set.', {}, 'Add ANTHROPIC_API_KEY to .env (needed from Phase 2).');
  try {
    const r = await getJson(ctx.fetch, 'https://api.anthropic.com/v1/models?limit=20', { 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' });
    return result('anthropic', label, 'pass', `Key works (${(r.data || []).length} models available).`);
  } catch (e) {
    return result('anthropic', label, 'fail', e.message, {}, 'Check the key at console.anthropic.com.');
  }
}

// `git push --dry-run` to a branch name that doesn't exist proves write access without changing anything.
async function checkGitPush(ctx) {
  const label = 'GitHub: publish study files';
  const repo = ctx.env.REPO_PATH || DEFAULT_REPO_PATH;
  const remote = await ctx.exec('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  if (remote.code !== 0) return result('git-push', label, 'fail', `No git repo at ${repo}.`, {}, 'Clone the studypulse repo (SETUP.md step 1) or set REPO_PATH.');
  const data = { remote: remote.stdout.trim() };
  const push = await ctx.exec('git', ['-C', repo, 'push', '--dry-run', '--porcelain', 'origin', 'HEAD:refs/heads/coach-probe-dry-run']);
  if (push.code === 0) return result('git-push', label, 'pass', 'Can push (dry run, nothing was changed).', data);
  const err = (push.stderr || push.stdout).trim().split(/\r?\n/).slice(-2).join(' ');
  return result('git-push', label, 'fail', `Dry-run push failed: ${err}`, data,
    'Sign in to GitHub on this PC: run `git push` once in the repo folder and complete the Git Credential Manager sign-in.');
}

async function checkRelay(ctx) {
  const label = 'Progress relay (Phase 3)';
  if (!ctx.env.RELAY_URL) return skip('relay', label, 'Not set up yet — that comes in Phase 3.');
  try {
    const r = await getJson(ctx.fetch, `${ctx.env.RELAY_URL}?action=ping`);
    return result('relay', label, r?.ok ? 'pass' : 'warn', r?.ok ? 'Relay answered.' : 'Relay answered, but not as expected.');
  } catch (e) {
    return result('relay', label, 'fail', e.message, {}, 'Re-deploy the Apps Script and copy the /exec URL.');
  }
}

// ── Summary ─────────────────────────────────────────────────────────

export function recommend(checks) {
  const by = id => checks.find(c => c.id === id) || { status: 'skip', data: {} };
  const ok = c => c.status === 'pass' || c.status === 'warn';
  const cw = by('classroom-coursework'), gmail = by('parent-gmail'), drive = by('drive');
  const canvas = by('canvas'), ics = by('lms-ics'), portal = by('lms-portal');

  let classroom = 'not tested yet';
  if (ok(cw)) classroom = 'Classroom API';
  else if (gmail.data?.classroomEmails30d) classroom = 'guardian email summaries (Plan B)';
  else if (by('student-signin').status === 'fail' || by('classroom-courses').status === 'fail') classroom = 'blocked: discuss Plan B/C';

  const grades = [];
  if (cw.data?.totals?.graded) grades.push('per-assignment grades from Classroom');
  if (canvas.data?.coursesWithScore) grades.push('course grades from Canvas');

  let college = 'not configured';
  if (canvas.status === 'pass') college = 'Canvas API (assignments + grades)';
  else if (ics.status === 'pass') college = 'calendar feed (due dates only; grades from emails)';
  else if (portal.data?.platform) college = `${portal.data.platform}: not connected yet`;

  return {
    classroom,
    college,
    grades: grades.length ? grades.join(' + ') : 'none visible yet',
    materials: drive.status === 'pass' || drive.status === 'warn' ? 'teacher files readable' : drive.status === 'skip' ? 'not tested' : 'not readable',
    nextSteps: checks.filter(c => c.fix && c.status !== 'pass').map(c => `${c.label}: ${c.fix}`),
  };
}

export async function runProbe(ctx) {
  ctx = { maxCourses: 10, now: new Date(), ...ctx };
  const state = { driveFiles: [] };
  const steps = [
    checkConfig, checkStudentSignIn, checkCourses, checkCoursework, checkMaterialsAndAnnouncements, checkDrive,
    checkPortal, checkCanvas, checkIcs, checkParentGmail, checkAnthropic, checkGitPush, checkRelay,
  ];
  const checks = [];
  for (const step of steps) {
    try {
      checks.push(await step(ctx, state));
    } catch (e) {
      checks.push(result(step.name, step.name, 'fail', `Unexpected error: ${netError(e)}`));
    }
    ctx.onCheck?.(checks[checks.length - 1]);
  }
  return { generatedAt: ctx.now.toISOString(), checks, recommendation: recommend(checks) };
}

// ── Output ──────────────────────────────────────────────────────────

const EMAIL = /([\w.+-])[\w.+-]*(@[\w-]+(\.[\w-]+)+)/g;
const maskEmail = s => String(s).replace(EMAIL, '$1***$2');

// Copy of the report that's safe to paste into a chat: no class names, titles, subjects or emails.
export function redact(report) {
  const aliases = new Map();
  const alias = v => { if (!aliases.has(v)) aliases.set(v, `[item ${aliases.size + 1}]`); return aliases.get(v); };
  const walk = (v, key) => {
    if (Array.isArray(v)) return key === 'samples' || key === 'subjects' ? v.map(() => '[redacted]') : v.map(x => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    if (typeof v !== 'string') return v;
    if (key === 'name') return alias(v);
    return maskEmail(v);
  };
  const out = walk(report);
  out.recommendation.nextSteps = report.recommendation.nextSteps;
  return out;
}

const TAG = { pass: '[PASS]', warn: '[WARN]', fail: '[FAIL]', skip: '[SKIP]' };

export function formatCheck(c) {
  const lines = [`${TAG[c.status]} ${c.label} — ${c.summary}`];
  for (const row of c.data?.courses || []) {
    const { name, ...rest } = row;
    const facts = Object.entries(rest).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`         • ${name}${facts ? ': ' + facts : ''}`);
  }
  if (c.fix && c.status !== 'pass') lines.push(`         → ${c.fix}`);
  return lines.join('\n');
}

export function formatSummary(report) {
  const r = report.recommendation;
  return [
    '',
    '── What this means ─────────────────────────────',
    `  Classroom data from : ${r.classroom}`,
    `  College portal      : ${r.college}`,
    `  Grades              : ${r.grades}`,
    `  Class materials     : ${r.materials}`,
    ...(r.nextSteps.length ? ['', '  To do next:', ...r.nextSteps.map(s => `   - ${s}`)] : []),
  ].join('\n');
}
