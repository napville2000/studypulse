# StudyPulse

An AI-powered quiz and flashcard generator for studying from your own notes, slides, or reading. It's a single static HTML file — no backend, no build step — that calls the Anthropic (Claude) API directly from the browser using your own API key.

**Live app:** https://napville2000.github.io/studypulse/

## Features

- **Quiz mode** — generates single-select, multi-select ("choose exactly 3"), and fill-in-the-blank questions from your study material, at a difficulty you choose (easy / standard / challenging / certification-style).
- **Flashcard mode** — flip-card term/definition review with "Still learning" / "Got it" rating.
- **Paste or upload content** — paste text directly, or upload a PDF/image. Text is extracted locally in the browser (pdf.js for PDFs, Tesseract.js for OCR on images) at no API cost. If OCR quality is poor, you can fall back to Claude Vision to extract the text instead.
- **Full Scope Mode** — checks your notes' coverage against the standard curriculum for the topic and lets you supplement missing concepts into the quiz.
- **Timed Mode** — optional per-question or full-quiz countdown for exam-style practice.
- **Study Guide + targeted retry** — after a quiz, generate a study guide for the concepts you missed, and re-quiz on just your weak areas.
- **Study Library & review queue** — generated study files are saved in your browser and listed under the Library tab; a review queue prioritizes concepts/terms you've previously missed (spaced-repetition style).
- **Notes tab** — attach and edit markdown notes alongside a study file.
- **Admin mode** — an instructor/admin can paste in a unit's notes once, generate a study file, and hand the resulting `.json` file to students to load directly (so students don't need to re-paste content).

## Getting started

1. Open the [live app](https://napville2000.github.io/studypulse/) (or run it locally — see below).
2. Get an API key from [console.anthropic.com](https://console.anthropic.com/) (starts with `sk-ant-...`) and paste it into the **API Key** field.
3. Add study content: paste text, or upload a PDF/image in the Study Content card.
4. Pick **Quiz** or **Flashcard** mode, adjust settings (question count, difficulty, timed mode, etc.), and generate.
5. Review your results, generate a study guide for anything you missed, and retry your weak areas.
6. Use **Save** to download a session as a `.json` file you can reload later.

### Running locally

No build step required — it's a single HTML file:

```bash
python -m http.server 8420
```

Then open `http://localhost:8420`.

## API key & privacy

- Your API key is entered by you, held only in the browser tab's memory, and used only to call `api.anthropic.com` directly — it's never hardcoded in the app and never sent anywhere else.
- If you use **Save** to download a session file mid-quiz, your API key is included in that file on purpose, so you don't have to re-enter it next time you load the session. Treat saved session `.json` files as sensitive — anyone who has the file has your key.
- Study files, your library, and notes are stored in your browser's `localStorage` and never leave your device except for the content you choose to send to Claude for generation.

## Tech stack

- Vanilla HTML/CSS/JavaScript — single file, no framework, no build tooling.
- [pdf.js](https://mozilla.github.io/pdf.js/) and [Tesseract.js](https://github.com/naptha/tesseract.js) (loaded from CDN) for local, free PDF/OCR text extraction.
- [Anthropic Claude API](https://docs.claude.com/) for generating quizzes, flashcards, and study guides.
