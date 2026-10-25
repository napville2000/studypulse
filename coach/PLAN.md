# StudyPulse Coach — daily assignment scan → focused study plan → auto-built quizzes

## Context

The parent's daughter is struggling in school. She is **strong at math** and **weak at memorization**, and her study skills are poor: she probably re-reads instead of recalling, crams, and can't tell what she doesn't know yet. Her work lives in **Google Classroom** and a **college portal** (LMS not yet identified). StudyPulse (`index.html`, a static single-file app on GitHub Pages) can already run quizzes and flashcards from v2 study files. Any file committed to `study-files/` shows up automatically in **Library → Class Library**, and the student needs no API key to use it.

**Goal:** a daily automated loop.
1. Scan both sites: assignments, due dates, grades, materials, announcements.
2. Find what matters: missing work, upcoming tests (including ones only mentioned in announcements), weak courses.
3. Generate review material shaped for a student who memorizes poorly but reasons well.
4. Publish it into StudyPulse and give her a short "Today" plan.
5. Feed her actual quiz and flashcard results back in, so tomorrow's plan adapts.
6. Email the parent a daily digest and a weekly summary.

**Decisions made:**
- Connect through official APIs with revocable tokens. No stored passwords. A browser-session reader is a last-resort fallback only.
- Split public and private data. The `studypulse` repo is **public**, so only study content goes there. Grades, assignments, plans, and progress stay private on the parent's PC and in a private Google Sheet.
- Three outputs: a student **Today** tab, a **daily parent email**, and a **weekly parent summary**.
- **Run locally on the parent's Windows PC, cloud-ready.** It is one Node script, scheduled by Windows Task Scheduler. Moving it to GitHub Actions later only needs a workflow file and secrets; no code changes.
- **Progress loop through a Google Apps Script relay**, backed by a private Sheet.
- **Access tests come first.** Nothing gets deployed until the read-only probe confirms what each site exposes.
- LMS is unknown, so the college connector is a swappable adapter. Canvas is the first-class adapter, and an ICS calendar feed is the universal fallback.

---

## Tutor design: how the system teaches (this drives every component)

| Principle | How the system applies it |
|---|---|
| **Retrieval, not re-reading** | Every session is recall first. Quizzes *are* the studying. Notes are opened only after a miss. |
| **Spacing beats cramming** | A per-item spaced-repetition scheduler (Leitner boxes 1–5: 1d, 2d, 4d, 8d, 16d) decides what to review. She never has to choose, which removes the executive-function load. |
| **Make memorization feel like math** | The generator tags each fact with a `memory_type`. **derive**: follows from a rule (e.g. ion charge from group number). These get a *rule card* plus 2–3 apply-the-rule problems. **structure**: fits a table, sequence, or pattern. These get grid- and sequence-completion questions. **hook**: truly arbitrary. These get a mnemonic, chunking, and tighter spacing. The goal is to shrink the pure-memorization pile by turning as much as possible into reasoning. |
| **Confidence calibration** | She taps Sure / Think so / Guess before the answer is revealed. Items answered **confidently wrong** jump to the top of the queue, because those are the misconceptions that hurt on tests. |
| **Small, fixed, finishable sessions** | 20–30 min max, with the same shape every day. 2-min warm-up on items she knows (a quick win). 10–15 min on today's focus topic. 5 min of due reviews. 2-min "blurt": a free-recall prompt answered on paper. The first task is always tiny. |
| **Backward-plan from tests** | When a test date is known or inferred, it triggers a 5-day ramp: learn → recall → mixed/interleaved → timed mock (existing Timed Mode) → light review the night before. |
| **Do vs. Learn** | The plan separates "Do" (homework due or missing) from "Learn" (study), so homework doesn't crowd out learning. Missing work always comes first. |
| **Spend time where the gap is** | Math gets assignment reminders only, unless its grade drops below the configured threshold. Study minutes go to memorization-heavy courses, weighted by grade gap × test proximity. |
| **Effort over outcomes for the parent** | The digest leads with effort: minutes studied, items mastered, streak. Then grades and risks. It includes 1–2 conversation starters. The student side never shows grades and stays encouraging. |

---

## Architecture (local-first)

```
 Parent's Windows PC  (Task Scheduler, daily ~6:00am + at logon if missed)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ studypulse\coach\  (code, in the public repo; no personal data)      │
 │   collect → normalize → diff → pull progress → learner → prioritize   │
 │      → generate (Claude) → publish units → plan → digest              │
 │                                                                      │
 │ %LOCALAPPDATA%\StudyPulseCoach\  (PRIVATE, outside any repo)          │
 │   .env (secrets) · student.json (config) · data\YYYY-MM-DD\* · logs\  │
 │   browser-profile\ (only if the browser fallback is needed)           │
 └───────┬───────────────────────────────┬──────────────────┬──────────┘
         │ git commit+push               │ setPlan / pull   │ Gmail API
         │ study-files\*.json only       │ progress         │ send
         ▼                               ▼                  ▼
   public studypulse repo         Apps Script relay     Parent inbox
   (GitHub Pages)                 (private Sheet)
         └──► StudyPulse app on her phone ◄──► relay (GET plan / POST progress)
```

**Why local:**
- Private data never leaves the PC except into the parent's own Google Sheet and email.
- No private repo, and no secrets in the cloud.
- Interactive OAuth and the browser fallback work naturally.
- It's easy to debug.

**Cost:** it runs only if the PC is on. Mitigations:
- The Task Scheduler task uses **"Run task as soon as possible after a scheduled start is missed"** and **"Wake the computer to run this task"**, plus an at-logon trigger.
- The script is idempotent per date, so a second run in a day is a no-op unless forced.
- The digest says when it was generated late.

**Why the code goes in the public repo:** the code holds nothing personal. Config, course names, tokens, and data all live in `%LOCALAPPDATA%\StudyPulseCoach\`. A pre-commit guard plus a publish-time assertion ensure only `study-files/*.json` content is ever committed by the job.

---

## Phase 0 — Access tests (before anything is deployed)

`coach/scripts/authorize.js` (one time, interactive):
- Opens a browser for Google OAuth. Run it twice: the **daughter's** account for Classroom + Drive, and the **parent's** account for `gmail.send` (+ `gmail.readonly` for the guardian-email fallback).
- Writes refresh tokens to `.env`.
- The OAuth client lives in the parent's own Google Cloud project, set to "In production" (unverified) so tokens don't expire after 7 days.

`coach/scripts/probe.js` (read-only, safe to re-run): prints a capability report and writes `probe-report.json`. It never writes anywhere.

| Check | Pass means |
|---|---|
| Classroom `courses.list` | courses visible (count + names) |
| `courseWork.list` + `studentSubmissions.list` | assignments, due dates, **assignedGrade present?** |
| `courseWorkMaterials` / attachments → Drive `files.export` | can read teacher materials as text |
| `announcements.list` | announcement text readable (for test detection) |
| LMS: detect from the portal URL → Canvas `/api/v1/users/self` with token, else the ICS feed URL | assignments, and grades if Canvas |
| Gmail search for Classroom guardian summaries | fallback source available |
| Anthropic key | one tiny call succeeds |
| GitHub push (dry run: `git push --dry-run`) | can publish units |
| Relay ping (once deployed) | plan and progress round-trip |

The outcome decides the source mix in `student.json`:
- If Classroom returns 403 `admin_policy_enforced` (school blocks apps for under-18 users), switch to the guardian-email collector.
- Optionally fall back further to the browser-session reader (`connectors/browser.js`, Playwright persistent profile that the daughter signs into once). It is clearly marked fragile and used only if needed.

---

## Components

### 1. Collectors (`coach/src/connectors/`)
Each collector outputs the common schema in `src/schema.js`: `Course{id, source, name, subject, gradePct}`, `Assignment{id, courseId, title, type(hw|quiz|test|project), dueAt, points, status(assigned|turned_in|missing|late|graded), grade, materialIds}`, `Material{id, title, text, url}`, `Announcement{id, courseId, text, postedAt}`.

- **`classroom.js`**: Classroom API with scopes `classroom.courses.readonly`, `classroom.coursework.me.readonly`, `classroom.courseworkmaterials.readonly`, `classroom.announcements.readonly`, `classroom.topics.readonly`, `drive.readonly`.
- **`canvas.js`**: Canvas REST with a student personal access token. Endpoints: `/users/self/todo`, `/courses?include[]=total_scores`, `/courses/:id/assignments?include[]=submission`, modules, announcements.
- **`ics.js`**: any LMS calendar feed. Due dates only.
- **`gmail-guardian.js`**: parses Classroom guardian summaries and portal notification emails.
- **`browser.js`** (fallback only): Playwright with a persistent profile, reading the Classroom To-do and grades pages.
- **`materials.js`**: Drive export (Docs and Slides as `text/plain`; PDFs through `pdf-parse`), with a cache keyed by file id and modified time.

### 2. Daily pipeline (`coach/src/pipeline.js`, `npm run daily`)
1. **Collect** from every enabled source, then write `data/<date>/snapshot.json`.
2. **Diff** against yesterday: new assignments, new grades, newly missing or late work, and grade changes of 3 points or more.
3. **Detect upcoming assessments.** Explicit ones come from coursework type and title. Inferred ones come from a Claude extraction pass over 14 days of announcements and materials, producing `{courseId, topic, date, confidence}`.
4. **Pull progress** events from the relay since the last run.
5. **Learner model** (`src/learner.js`):
   - Per-item Leitner state keyed `unitSlug#group` (questions) or `unitSlug#term` (cards).
   - Concept mastery = share of items in box ≥ 3.
   - Course risk = f(grade gap, missing count, mastery).
6. **Prioritize** (`src/prioritize.js`): score each topic as `urgency × weight(test > quiz > hw) × (1 − mastery) × courseRisk`. Apply the math-strength rule.
7. **Generate** (`src/generate.js`, Claude API):
   - Build or extend a v2 study file with the same schema as `study-files/*.json`.
   - Reuse the prompt shapes from `index.html`: `buildPrompt` (~L971), `fcPrompt` (~L1235), `answerListPrompt` (~L1484). Extend them with memory-type tagging and mnemonic and rule generation.
   - `src/validate.js` checks the output: schema, one correct answer, distinct distractors, `group` set.
8. **Publish:** write units into the local clone's `study-files/`, then `git add study-files/<slug>.json && git commit && git push`.
   - Before committing, assert that no keys like grade, score, sessions-with-data, or names appear.
   - Abort if anything outside `study-files/` is staged.
9. **Plan** (`src/plan.js`): build the Today plan `{date, streak, do[], learn[{unitSlug, mode, focusConcepts, minutes, why}], review{dueItemKeys, minutes}, blurt}`, then call relay `setPlan`.
10. **Digest** (`src/digest.js`): send an HTML email through the Gmail API. Contents: effort, grades and changes, missing work, upcoming tests with readiness %, today's plan, and conversation starters.

`npm run weekly` (Task Scheduler, Sundays): trends, mastery growth, concepts that keep slipping, next week's test calendar, and suggestions.

### 3. StudyPulse app changes (`index.html`)
- **Today tab:** a 6th tab button (~L757). It fetches the plan from the relay with the stored sync code and renders Do / Learn / Review / Blurt with check-offs and a streak. Each Learn block opens the unit through `loadRemoteFile` / `safeClassPath` (~L1444–1455) in the right mode with its focus concepts.
- **Settings:** a "Coach sync code" field, saved in `localStorage`.
- **Memorization fields (optional, backward compatible):**
  - Questions get `memory_type`, `mnemonic`, and `rule`. Cards get `memory_type` and `mnemonic`.
  - Shown in wrong-answer feedback (`selectSS` / `submitMS` / `submitFB`, ~L1121–1127) and on the card back (`renderFc`, ~L1248).
  - New `sequence` question type (tap in order, partial credit).
- **Confidence tap:** Sure / Think so / Guess, stored on `userAnswers[i].confidence`.
- **Spaced repetition:**
  - `item_stats` on the study file, persisted by `upsertLibraryEntry` (~L1286) and added to its `keep(...)` list.
  - `buildSavedQuiz` (~L1386) puts due and confident-wrong items first.
  - `rateFc` (~L1253) updates card boxes.
- **Progress sync:** after `showResults` (~L1132) and at the end of a deck, queue `{unit, date, items:[{key, correct, confidence}], minutes}` in `localStorage` and POST it to the relay, retrying until it's acknowledged. No API key and no answer text is sent.
- Update `README.md` and `study-files/README.md`.

### 4. Relay (`coach/relay/Code.gs`)
Apps Script web app deployed by the parent, backed by a private Sheet.
- `doGet` `action=plan` (sync code) and `doPost` `action=progress` (sync code) are called by the app.
- `setPlan` and `getProgress` (separate server secret) are called by the PC.
- The app uses `text/plain` POSTs to avoid a CORS preflight.

### 5. Config & secrets (all in `%LOCALAPPDATA%\StudyPulseCoach\`)
- `.env`: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `CLASSROOM_REFRESH_TOKEN`, `GMAIL_REFRESH_TOKEN`, `CANVAS_BASE_URL` + `CANVAS_TOKEN` or `LMS_ICS_URL`, `RELAY_URL`, `RELAY_SERVER_SECRET`, `REPO_PATH`.
  - The folder ACL is restricted to the parent's Windows user.
  - Optionally move secrets into Windows Credential Manager later.
- `student.json`:
  - timezone, session minutes (25), target grade (85)
  - `strengths:["math"]`, with a math threshold of 80
  - enabled sources, and a course → subject map tagged math or memorization-heavy
  - digest address and Leitner intervals
- `coach/scripts/install-task.ps1`: registers the daily and weekly tasks with the settings above (`StartWhenAvailable`, `WakeToRun`, logon trigger).
- **Cloud later:** add `.github/workflows/daily.yml` with the same env vars as secrets. `pipeline.js` reads config from an env-overridable path, so nothing else changes.

---

## Delivery phases
0. **Access tests:** `authorize.js` + `probe.js` → capability report → pick the source mix. *No deploys and no commits by the job.*
1. **Visibility:** collectors, snapshot/diff, daily parent email, Task Scheduler install.
2. **Content engine:** assessment detection, prioritization, generation with memory types, publishing to `study-files/`, and app support for the new fields and `sequence`.
3. **Closed loop:** relay, Today tab, sync code, `item_stats` spaced repetition, confidence taps, progress feeding the learner model.
4. **Polish:** weekly summary, 5-day test ramp, threshold tuning.

**From the parent:**
- Create the Google Cloud project and OAuth client, and enable the Classroom, Drive, and Gmail APIs. `SETUP.md` walks through it.
- Do the sign-in with the daughter.
- Provide the portal URL.
- Install Node 20 on the PC.
- Deploy the Apps Script relay (copy-paste; Phase 3).

## Verification
- **Phase 0:** run `probe.js` and review `probe-report.json` together before writing collectors against real data.
- **Unit tests** (`node --test` in `coach/`):
  - connector normalization against fake fixture JSON
  - diff, Leitner scheduling, prioritization
  - the generator validator
  - the publish guard, which must reject grade fields and non-`study-files` paths
- **Dry run:** `npm run daily -- --dry-run --fixtures` writes the snapshot, plan, digest HTML, and units to a temp folder. No push, email, or relay writes. I'll review the digest and plan by eye.
- **App:** `python -m http.server 8420` + Playwright, against a mock relay:
  - The Today tab renders; a Learn block opens a unit.
  - Confidence taps update `item_stats`; progress is POSTed.
  - The existing `chemical-bonding.json` and `electrons-in-atoms.json` still work unchanged.
- **Live:** run `npm run daily` manually once in dry run, then for real. Confirm the email arrives, the unit appears in the Class Library, and the Today tab shows the plan. Then run `install-task.ps1` and confirm the next scheduled run in Task Scheduler history.
