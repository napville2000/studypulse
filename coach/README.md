# StudyPulse Coach

A daily study coach that runs on the parent's PC. Each morning it will:
- read the student's Google Classroom and college portal
- work out what to focus on: missing work, upcoming tests, weak topics
- build memorization-friendly quizzes into StudyPulse's Class Library (`../study-files/`)
- give her a short "Today" plan, and email the parent a digest

**Continuing on your own PC? Start with [HANDOFF.md](HANDOFF.md).**

**Status: Phase 0 — access tests.** For now only the read-only access check exists. It shows what each site exposes before anything else is built. See **[SETUP.md](SETUP.md)**.

| Command | What it does |
|---|---|
| `npm run authorize:student` | One-time Google sign-in for the student's school account (read-only scopes) |
| `npm run authorize:parent` | One-time Google sign-in for the parent's Gmail (send digest, read Classroom emails) |
| `npm run probe` | Read-only access test; writes `probe-report.json` + `probe-report.redacted.json` |
| `npm test` | Unit tests (no network) |

## Privacy
- This folder holds code only.
- Tokens, settings, reports and any student data live in `%LOCALAPPDATA%\StudyPulseCoach\` on Windows (`~/.studypulse-coach/` elsewhere). Set `STUDYPULSE_COACH_HOME` to override. Nothing personal is ever committed to this public repo.
- Requires Node 20+. No npm dependencies.
