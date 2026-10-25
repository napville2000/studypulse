# StudyPulse Coach — Phase 0 setup: access tests

This step only **checks access**. Nothing gets scheduled, published or emailed. When you're done you'll have a short report showing exactly what the coach can see in Google Classroom and the college portal. We use it to decide how the rest gets built.

Time needed: about 30–40 minutes, with your daughter there for step 4 (about 5 minutes).

> **Talk to her first.** This works much better as "a tool to help you study smarter" than as monitoring. Let her do her own sign-in in step 4, and show her what it can and can't see.

All commands below are for **PowerShell** on Windows. Open it from the Start menu → "Windows PowerShell".

---

## 1. Install Node and Git, get the code

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```
Close and reopen PowerShell, then:

```powershell
cd $HOME
git clone https://github.com/napville2000/studypulse.git
cd studypulse\coach
node --version   # should print v20 or newer
```

There's nothing to `npm install`: the coach has no dependencies.

## 2. Create your own Google "app" (one time, your Gmail account)

The coach talks to Google through an app that **you own**. It lives in your Google account, and no one else has access to it.

1. Go to <https://console.cloud.google.com/> and sign in with **your** Gmail.
2. Top bar → project picker → **New project** → name it `StudyPulse Coach` → **Create**, then make sure it's selected.
3. **APIs & Services → Library**. Search for and **Enable** each of these:
   - **Google Classroom API**
   - **Google Drive API**
   - **Gmail API**
4. **APIs & Services → OAuth consent screen** (Google may call it "Google Auth Platform"). Click **Get started**:
   - App name `StudyPulse Coach`, support email = your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail → **Create**.
5. **Audience → Publish app → Confirm**, so the status reads **In production**.
   - *Why:* in "Testing" mode Google expires the sign-in every 7 days.
   - Your app will show an "unverified app" warning at sign-in. That's expected for a private app like this one (Google allows up to 100 users without verification).
6. **Clients → Create client** → Application type **Desktop app** → name `coach` → **Create**. Copy the **Client ID** and **Client secret**.

## 3. Make your private settings file

Your settings live outside the code folder, in a folder only your Windows user can read:

```powershell
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\StudyPulseCoach"
Copy-Item .env.example "$env:LOCALAPPDATA\StudyPulseCoach\.env"
notepad "$env:LOCALAPPDATA\StudyPulseCoach\.env"
```

Fill in and save:
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from step 2.
- `LMS_PORTAL_URL`: the college portal address she types to log in.
- `ANTHROPIC_API_KEY`: the same key you use in StudyPulse. Optional for now.

Leave the other lines empty. The next steps fill them in.

## 4. Sign in (once per account)

**Your daughter**, with her **school** Google account (the one Classroom uses):
```powershell
npm run authorize:student
```

**You**, with your Gmail. This is used later to send you the daily email, and as a backup source:
```powershell
npm run authorize:parent
```

At each sign-in:
- A browser opens.
- Google warns "Google hasn't verified this app". Click **Advanced → Go to StudyPulse Coach (unsafe)**. It's your own app from step 2.
- **Leave every permission box ticked.**
- When the page says "Signed in ✓", go back to PowerShell.

What the coach can do with these sign-ins:
- **Her account:** **read-only** access to her classes, assignments, her own grades, announcements and class files. It cannot submit, edit, delete or post anything.
- **Your account:** send email (the digest) and read Classroom notification emails.

## 5. Run the access test

```powershell
npm run probe
```

It prints one line per check, then a "What this means" summary and a to-do list. It is **read-only**; you can run it as often as you like. Typical first run:

```
[PASS] Classroom: courses — 6 active class(es).
[PASS] Classroom: assignments & grades — 84 assignments, 51 with a grade visible, 9 due in the next 2 weeks.
[WARN] College portal: which system — Looks like Canvas (url/header).
         → Canvas: have her create a token (Account > Settings > + New Access Token) ...
```

Follow the → hints, update `.env`, and run `npm run probe` again. For the college portal the probe tells you what to add:
- **Canvas:** she creates an access token in Canvas. Put it in `CANVAS_BASE_URL` + `CANVAS_TOKEN`.
- **Anything else (or Canvas with tokens turned off):** the portal's **calendar feed** link. Put it in `LMS_ICS_URL`. The probe's hint says where to find it.

## 6. Send Claude the safe copy of the report

The probe saves two files in `%LOCALAPPDATA%\StudyPulseCoach\`:
- `probe-report.json`: full detail, including class names. **Keep it private.**
- `probe-report.redacted.json`: the same counts and results, with class names, file names, email subjects and email addresses removed. **Paste this one into the chat with Claude.**

```powershell
notepad "$env:LOCALAPPDATA\StudyPulseCoach\probe-report.redacted.json"
```

---

## If the school blocks it

Many school Google accounts for students under 18 don't allow outside apps. You'll know because step 4 shows **"Access blocked"**, **"Error 400: admin_policy_enforced"** or **"This app is blocked"**, or the probe says "Her school's Google admin blocks this".

The design has two fallbacks:
- **Plan B: guardian email summaries (no school approval needed).** Ask her teachers, or the school office, to add you as a **guardian** in Google Classroom. When the invite arrives, choose **daily** summaries. These emails list missing work, upcoming work and class activity. The coach reads them from your Gmail (step 4, parent sign-in). It gets less detail than the API: usually no grades, and no class files.
- **Plan C: ask school IT to allow your app.** Email them something like:

  > My daughter, *name*, uses a personal study tool I built. It needs read-only access to her own Google Classroom data. Could you allow the OAuth client ID `<your client ID from step 2>` under Admin console → Security → API controls → App access control? The scopes are classroom.courses.readonly, classroom.coursework.me.readonly, classroom.courseworkmaterials.readonly, classroom.announcements.readonly, classroom.topics.readonly and drive.readonly.

## Undo / revoke at any time
- **Google:** <https://myaccount.google.com/permissions> → StudyPulse Coach → Remove access (do it on her account and on yours).
- **Canvas:** Account → Settings → delete the token.
- **Everything local:** delete the `%LOCALAPPDATA%\StudyPulseCoach` folder.
