# Handoff: continue StudyPulse Coach on your own PC

This picks up the cloud session's work in **Claude Code running locally on your Windows PC**. Running it locally is simpler: Claude can run the commands, read the results and fix problems with you directly, with no copy-pasting between windows.

---

## Where things stand

| | Status |
|---|---|
| Overall design (how it teaches, what it builds) | ✅ Done: see [PLAN.md](PLAN.md) |
| Phase 0 access test: sign-in script + read-only probe | ✅ Built and tested (24 tests, against simulated data) |
| Tried against her real accounts | ❌ Not yet: this is the next step |
| Phase 1–4 (daily email, quiz building, Today tab, weekly summary) | ⏳ Not started |

**What we know so far:**
- The college portal is **Canvas**, and it **allows student tokens** (she was able to create one). That's the easiest kind of portal to connect.
- Google Classroom is untested. It needs a one-time Google Cloud setup, which is the most fiddly part.

**One loose end:** a Canvas token was pasted into the cloud chat. If you haven't already, delete it in Canvas (**Account → Settings → Approved Integrations → trash icon**) and make a new one.

---

## Make it simpler: start with Canvas only

The Google Cloud setup is the complicated part. Skip it for now:

1. **Start with Canvas only.** It needs just her token, and it gives you assignments, grades, missing work and course content.
2. **Add Google Classroom afterwards**, as a separate step, once the Canvas side is working.

---

## Your steps (about 15 minutes)

1. **Install the tools**, in PowerShell. Close and reopen PowerShell afterwards:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   Then install Claude Code: see <https://code.claude.com/docs> → Quickstart (Windows).

2. **Get the code**, including this branch (it isn't merged yet):
   ```powershell
   cd $HOME
   git clone https://github.com/napville2000/studypulse.git
   cd studypulse
   git checkout claude/kind-hopper-n4n5m0
   ```

3. **Start Claude Code** in that folder:
   ```powershell
   claude
   ```

4. **Paste this as your first message:**

   > Read `coach/HANDOFF.md` and `coach/PLAN.md`. We're picking up from a cloud session. Start with **Canvas only**:
   > 1. Help me create the private settings file at `%LOCALAPPDATA%\StudyPulseCoach\.env` from `coach/.env.example`. I'll paste the Canvas token into it myself in Notepad. Don't ask me to paste it in chat.
   > 2. Run `npm run probe` in `coach/` and explain the results in plain English.
   > 3. Then propose the smallest next step toward a daily email of her assignments and grades.
   > Follow the privacy rules in HANDOFF.md.

5. When it opens Notepad, add these lines, then save:
   ```
   CANVAS_BASE_URL=<her Canvas address, e.g. https://yourcollege.instructure.com>
   CANVAS_TOKEN=<the NEW token>
   LMS_PORTAL_URL=<same Canvas address>
   ```

---

## For Claude: context and rules

**What the system is:** a daily study coach for a high-school / dual-enrollment student who is strong at math and weak at memorization, with poor study habits. Each morning it will:
- read Canvas and Google Classroom
- find missing work, upcoming tests and weak topics
- generate memorization-friendly quizzes and flashcards into StudyPulse's Class Library (`study-files/*.json`, v2 schema)
- give her a 20–30 minute "Today" plan, and email the parent a digest
- send the parent a weekly summary

The teaching design (retrieval practice, spaced repetition, the "derive / structure / hook" memory types, confidence taps, test ramps) is in [PLAN.md](PLAN.md) → "Tutor design".

**Decisions already made (don't re-ask):**
- Runs **locally on the parent's Windows PC**, scheduled with Task Scheduler. Node 20+, **no npm dependencies** so far; keep it that way unless one is clearly needed.
- **Official APIs with revocable tokens only.** No passwords and no scraping, except as a last-resort fallback the parent approves.
- Her quiz results flow back through a small **Google Apps Script relay** with a private Sheet (Phase 3).
- Build in phases. Each one is useful on its own: 0 access test → 1 daily email → 2 quiz building → 3 Today tab + feedback loop → 4 weekly summary.

**Privacy rules (must keep):**
- The `studypulse` repo is **public**. Only study content goes in it: notes, quizzes, flashcards.
- **Never commit** grades, assignment lists, names, emails, the college's name or address, tokens, or `.env` / probe reports.
- Everything private lives in `%LOCALAPPDATA%\StudyPulseCoach\`: `.env`, `probe-report.json`, data, logs. It is already excluded from git.
- Never ask the parent to paste a token or key into the chat. They edit `.env` themselves in Notepad.
- The student-facing side never shows grades, and stays encouraging.

**Code map (`coach/`):**

| File | What it does |
|---|---|
| `scripts/probe.js` → `src/probe.js` | Read-only access test, one check per data source; writes a full and a redacted report |
| `scripts/authorize.js` → `src/google-auth.js` | One-time Google sign-in (Desktop OAuth + PKCE); saves refresh tokens to `.env` |
| `src/config.js` | Finds the private folder; reads and writes `.env` (real environment variables win) |
| `src/lms-detect.js`, `src/ics.js` | Works out which portal system it is; reads calendar feeds (fallback) |
| `test/` | `npm test`. Simulated HTTP only, never real accounts |

The StudyPulse app itself is `index.html` (single file, no build). The places Phase 2–3 will change are listed in PLAN.md → "StudyPulse app changes".

**Gotchas:**
- The Google OAuth app must be **"In production"**. In "Testing" mode, sign-ins expire every 7 days.
- Schools often block outside apps on accounts of students under 18. The fallbacks are guardian email summaries (Plan B) or asking school IT to allow the app's client ID (Plan C). Both are in SETUP.md.
- Canvas: if module content is hidden for students, build quizzes from assignment descriptions and her own notes instead.
- Commits need the attribution lines the repo has been using, and work stays on a branch until the parent merges it.
