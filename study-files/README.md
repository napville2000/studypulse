# Class Library

Every `.json` study file in this folder shows up automatically in StudyPulse's **Library → Class Library** list. No list to maintain, no API key or GitHub token needed to read them.

## Adding a unit

1. In StudyPulse, open **Admin**, enter your API key and a unit name.
2. Pick **Notes** or **Question & Vocab List** and paste the material.
3. Leave **Pre-build a quiz** and **Pre-build flashcards** on, then tap **Generate Study File**. A file like `chemical-bonding.json` downloads.
4. On GitHub, open this `study-files` folder → **Add file → Upload files**, drop the file in, and commit.
5. About a minute later (after GitHub Pages redeploys) it appears in the Class Library.

Uploading a file with the same name replaces the old version. The student keeps their progress, because progress is matched by unit name.

## Direct links

- Open the Class Library list: `https://napville2000.github.io/studypulse/#library`
- Open one unit: `https://napville2000.github.io/studypulse/?file=chemical-bonding` (the filename, without `.json`)

## Optional: index.json

The app lists this folder with GitHub's public API. If that API is unreachable (for example, rate-limited at 60 requests per hour per device), the app falls back to an optional `index.json` here:

```json
[
  { "file": "chemical-bonding.json", "title": "Chem – Ionic & Covalent Bonding" }
]
```
