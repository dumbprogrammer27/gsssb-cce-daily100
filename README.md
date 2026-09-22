# CCE Adaptive 100 — v3

GSSSB CCE prelim practice portal built for **topic-wise Daily 100 + adaptive revision**.

## Core rule

For every topic, the active challenge contains **100 MCQs**. The next 100 does not unlock until the current 100/100 is completed.

After completion, the server stores which concepts/questions were wrong and the next 100 is generated with extra weight on those weak areas.

Default adaptive mix after mistakes exist:
- ~55% fresh variants targeting previous mistakes / weak concepts
- ~25% PYQ-style recurring patterns
- ~20% fresh topic coverage

For a first set with no mistake history, it asks Gemini for roughly 40% PYQ-style patterns + 60% fresh coverage.

## New in v3

- Topic-wise **Adaptive 100** instead of 20-question topic drills
- 100/100 completion lock before the next set
- Same active set can be resumed after closing/reopening the website
- Active-set state also syncs through your login/cloud progress
- Wrong answers automatically enter the revision bank
- Next AI set receives prior wrong-concept signals
- Gemini-generated questions include answer, explanation, difficulty and PYQ-pattern flag
- Every wrong answer shows the correct answer + explanation + a focused YouTube learning search
- Online source-analysis layer can inspect selected public previous-paper pages and public YouTube paper-solution videos
- Current affairs still syncs from official PIB RSS
- Secure email/password login + PostgreSQL/Neon progress sync

## How online PYQ/video analysis works

The server has a curated source list containing public GSSSB CCE previous-paper index pages and public CCE paper-solution videos. Gemini analyzes **patterns, topic frequency, traps and question styles**. The prompt explicitly tells it not to copy long/verbatim copyrighted question text. New MCQs are generated as original variants.

The source analysis is generated only when you press **Refresh PYQ/video analysis** in the Sources tab, then cached in PostgreSQL and reused. This avoids wasting the free API quota during normal question generation.

## Required Render environment variables

### 1. Neon/PostgreSQL

```text
DATABASE_URL=<your Neon PostgreSQL connection string>
```

### 2. Gemini API

Create an auth/API key in Google AI Studio, then add:

```text
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-3.7-flash
GEMINI_VIDEO_MODEL=gemini-3.7-flash
```

Do **not** put the Gemini key inside `app.js`, `index.html`, GitHub, or any frontend code. It is used only by `server.js`.

Optional:

```text
SESSION_DAYS=30
```

## Render settings

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check: /health
```

The app binds to Render's `PORT` automatically.

## Database tables

Created automatically on first boot:
- `cce_users`
- `cce_sessions`
- `cce_progress`
- `cce_topic_sets`
- `cce_source_analysis`

No manual SQL import is needed.

## Important quota design

The app does **not** pre-generate 100 questions for every topic every morning. That would burn free API quota even for topics you never open.

Instead it generates a topic's 100 questions **on demand**. Once generated, that exact set is stored in PostgreSQL and reused/resumed until you finish it. Only after 100/100 does the next set become eligible for generation.

## Local run

Node.js 20+:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Without `DATABASE_URL`, the site still works in guest/local mode. Without `GEMINI_API_KEY`, normal local/generated practice works, but AI-adaptive 100 and online source analysis are disabled.

## Security

- Passwords are hashed with Node `scrypt`.
- Sessions use HttpOnly, SameSite cookies; production HTTPS adds Secure.
- SQL uses parameters.
- Auth endpoints are rate-limited.
- Gemini key and database URL stay server-side only.

## Source families configured

- GSSSB CCE previous-paper index/download pages (public educational portals)
- Public YouTube CCE paper-solution / paper-analysis videos
- Press Information Bureau (PIB) RSS for live current affairs

Use the **Sources** tab to refresh the cached PYQ/video analysis after deployment.
