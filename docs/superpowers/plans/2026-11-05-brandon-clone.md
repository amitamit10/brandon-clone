# Brandon Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, hosted, personal clone of whatbrandonthinks.com that turns a WhatsApp group export into persona-written reports (group, per-member, follow-up) with shareable links.

**Architecture:** A Cloudflare Worker (Hono) serves a JSON API and the static React UI. A WhatsApp parser and a stats module (pure TypeScript) produce facts. A staged LLM pipeline (chunk summaries, then report) runs as a step-driven job: the browser repeatedly calls `advance`, and each call does one LLM call, so no request exceeds Worker limits and progress is visible. State lives in D1.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Hono, React + Vite, Vitest (+ `@cloudflare/vitest-pool-workers` for Worker/D1 tests), `fflate` (zip), Google AI Studio (Gemini) + OpenRouter `:free` models.

**Spec:** `docs/superpowers/specs/2026-11-05-brandon-clone-design.md`

## Global Constraints

- Free LLM tiers only: Google AI Studio primary, OpenRouter `:free` fallback, selected by env vars. Keys only as Worker secrets / `.dev.vars` (git-ignored), never in the repo or client bundle.
- WhatsApp **group** chats only. No payments, accounts, email, other chat apps.
- Cloudflare Workers + D1 on the user's personal account. The user runs `wrangler login` themselves; never ask for tokens in chat. Production hostname: `brandon.amit.rest`.
- App is public, no login. Abuse limits: per-IP rate limit, upload size cap (10 MB), chats auto-delete after 30 days.
- Share links: random 128-bit IDs, revocable, show real member names (no masking).
- Every quote shown in a report must be an exact substring of the chat (after normalization); otherwise it is dropped.
- UI states plainly that free-tier AI providers may use prompts for training.
- `samples/` is private and git-ignored. Tests must not depend on it; use small synthetic fixtures in `tests/fixtures/`.
- Own mascot, copy and demo data. Copy the site's structure and feel, not its brand assets or testimonials.
- No accounts means history is client-side: the browser keeps its chat/report IDs in `localStorage`.

## Review Focus

Inputs the spec implies that no feature task tests by default; each has a test in the owning task.

1. Date ambiguity: `3/4/25` could be MDY or DMY, and 12h vs 24h clocks. Detect from the whole file (any value >12), not line one. (Task 2)
2. A message line that itself starts with something timestamp-shaped, names containing `:`, emoji or bidi marks. (Task 2)
3. A zip with several files, non-UTF-8 entry names, or a bare `.txt`. (Task 3)
4. A tiny chat (<30 messages), a single sender, or an empty file: a clear error, no model call. (Tasks 4, 8)
5. A free model that returns invalid JSON, a 429 mid-job, or invents a quote: the job retries, falls back, or resumes from stored progress. (Tasks 5, 6, 8)

---

## File Structure

```
wrangler.jsonc  vite.config.ts  vitest.config.ts  package.json  tsconfig.json
migrations/0001_init.sql
src/shared/types.ts            # Message, ParsedChat, ChatStats, Report, JobState
src/parser/whatsapp.ts         # parseExport
src/parser/zip.ts              # extractChatText
src/stats/compute.ts           # computeStats
src/llm/provider.ts            # LlmProvider, RateLimitError, createFallbackProvider
src/llm/gemini.ts  openrouter.ts  index.ts   # concrete providers + createProviderFromEnv
src/pipeline/chunk.ts          # chunkMessages
src/pipeline/personas.ts       # PERSONAS prompts (brandon, clara, diego)
src/pipeline/summarize.ts      # summarizeChunk
src/pipeline/report.ts         # generateReport, verifyQuotes
src/pipeline/search.ts         # searchChunks (BM25)
src/worker/index.ts            # Hono app, routes, scheduled()
src/worker/db.ts               # typed D1 repository
src/worker/jobs.ts             # advanceReport
src/worker/ratelimit.ts
web/                           # React UI (pages: Landing, Setup, Report, History, Shared)
tests/...                      # mirrors src/
```

---

### Task 1: Scaffold, tooling, health check

**Files:** Create all root config files, `src/worker/index.ts`, `web/index.html`, `web/main.tsx`, `tests/worker/health.test.ts`.

**Interfaces:**
- Produces: `app` (Hono) default-exported from `src/worker/index.ts`; `Env` type with `DB: D1Database`, `ASSETS: Fetcher`, `GEMINI_API_KEY?: string`, `OPENROUTER_API_KEY?: string`, `LLM_PRIMARY?: 'gemini'|'openrouter'`.

- [ ] **Step 1:** Write `tests/worker/health.test.ts`: `GET /api/health` returns 200 `{ok:true}`.
- [ ] **Step 2:** Run `npx vitest run tests/worker/health.test.ts`. Expected: FAIL (no app).
- [ ] **Step 3:** Scaffold Vite + React, Hono Worker, `wrangler.jsonc` with `assets` binding and `run_worker_first: ["/api/*"]` (API routes must win over the static-assets fallback; see the `cloudflare-workers-assets-intercept-gotcha` skill), D1 binding `DB`, daily cron trigger. Implement `GET /api/health`.
- [ ] **Step 4:** Run `npx vitest run` and `npx wrangler dev` (curl `/api/health`). Expected: PASS and `{"ok":true}`.
- [ ] **Step 5:** Verify the current Cloudflare free-plan limits for subrequests per invocation, CPU time and D1 writes, and write the findings as a short comment block at the top of `src/worker/jobs.ts` (they drive the step-per-LLM-call design).
- [ ] **Step 6:** Commit `chore: scaffold worker, ui and test tooling`.

### Task 2: WhatsApp parser

**Files:** Create `src/shared/types.ts`, `src/parser/whatsapp.ts`, `tests/parser/whatsapp.test.ts`, `tests/fixtures/android-mdy.txt`, `ios-dmy.txt`, `tricky.txt`.

**Interfaces:**
- Produces:
  ```ts
  interface Message { id: number; ts: number /* wall-clock as UTC ms */; sender: string; text: string; kind: 'text'|'media'|'deleted'; edited: boolean }
  interface ParsedChat { messages: Message[]; participants: string[]; systemEvents: {ts:number; text:string}[]; format: 'android'|'ios'; dateOrder: 'mdy'|'dmy' }
  function parseExport(text: string): ParsedChat   // throws ParseError('no_messages') if none found
  ```

- [ ] **Step 1:** Write failing tests with exact assertions:
  - `parses android MDY 24h` (`8/28/25, 23:29 - Name: hi` → `ts` = 2025-08-28T23:29Z, sender `Name`).
  - `parses ios DMY with seconds` (`[28/08/2025, 23:29:05] Name: hi`).
  - `detects dmy when any first number >12`, and `detects mdy when any second number >12`.
  - `joins multi-line messages` (continuation lines appended with `\n`).
  - `continuation line starting with a timestamp-shaped string is only a new message if the line matches the full header pattern`.
  - `strips U+200E/U+202A–202E bidi marks and keeps emoji in sender names`.
  - `sender names containing ':' are not split wrongly` (header regex anchors on the first `": "` after the timestamp separator).
  - `classifies <Media omitted> as media, "This message was deleted" / "You deleted this message" as deleted, strips trailing "<This message was edited>" and sets edited`.
  - `system lines (no sender) go to systemEvents, not messages`.
  - `12h AM/PM clocks are parsed`.
  - `throws ParseError on empty or non-chat text`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement `parseExport`: normalise bidi marks, detect format by header regex, detect date order by scanning every header (default `mdy` for android, `dmy` for ios when ambiguous), then a single pass that appends continuation lines. Sender is the text before the first `": "` in the post-header string; a line with no such separator is a system event.
- [ ] **Step 4:** Run, expect PASS. Then run the parser once by hand against `samples/extracted/*.txt` and confirm about 14.4k messages and 10 participants (manual check, not a test).
- [ ] **Step 5:** Commit `feat: whatsapp export parser`.

### Task 3: Zip extraction

**Files:** Create `src/parser/zip.ts`, `tests/parser/zip.test.ts`.

**Interfaces:** Produces `function extractChatText(bytes: Uint8Array, filename: string): string` (throws `ParseError('no_chat_file')`).

- [ ] **Step 1:** Tests: `returns text of a bare .txt upload`; `finds the .txt inside a zip with a .vcf beside it`; `picks the largest .txt when a zip has several`; `works when entry names are not valid UTF-8`; `throws no_chat_file for a zip without .txt`. Build zips in the test with `fflate.zipSync`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement with `fflate.unzipSync` (filter by extension on raw name bytes), decode UTF-8, drop a BOM.
- [ ] **Step 4:** Run, expect PASS. Commit `feat: zip/txt extraction`.

### Task 4: Stats

**Files:** Create `src/stats/compute.ts`, `tests/stats/compute.test.ts`, `tests/fixtures/stats-chat.ts` (small hand-built `ParsedChat` with known answers).

**Interfaces:**
- Consumes: `ParsedChat`.
- Produces:
  ```ts
  interface MemberStats { messages: number; words: number; media: number; deleted: number; edited: number; starters: number; topEmojis: [string, number][]; avgReplyMs: number | null; busiestHour: number }
  interface ChatStats { firstTs: number; lastTs: number; days: number; total: number; perMember: Record<string, MemberStats>; hourHistogram: number[]; weekdayHistogram: number[]; busiestDay: {date: string; count: number}; longestSilence: {fromTs: number; toTs: number}; shiftWeek: {weekStart: string; ratio: number} | null }
  function computeStats(chat: ParsedChat, opts?: {conversationGapMs?: number}): ChatStats  // default gap 6h
  function assertAnalyzable(chat: ParsedChat): void  // throws ParseError('too_small') if <30 messages or <2 senders
  ```

- [ ] **Step 1:** Tests with hand-computed values: `counts messages and words per member`; `a "starter" is the first message after a gap >= 6h`; `busiest day and hour`; `longest silence`; `shiftWeek is the week whose volume differs most from the trailing 4-week mean, null if <8 weeks`; `emoji counting handles multi-codepoint emoji`; `assertAnalyzable rejects 29 messages and a single sender`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: chat stats`.

### Task 5: LLM provider layer

**Files:** Create `src/llm/provider.ts`, `gemini.ts`, `openrouter.ts`, `index.ts`, `tests/llm/fallback.test.ts`, `tests/llm/gemini.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  interface LlmRequest { system: string; prompt: string; json?: boolean; maxTokens?: number }
  interface LlmProvider { name: string; generate(req: LlmRequest): Promise<{ text: string }> }
  class RateLimitError extends Error { retryAfterMs?: number }
  function createFallbackProvider(providers: LlmProvider[], opts: { retries: number; sleep: (ms: number) => Promise<void> }): LlmProvider
  function createProviderFromEnv(env: Env): LlmProvider   // throws if no key configured
  async function generateJson<T>(p: LlmProvider, req: LlmRequest, validate: (x: unknown) => T): Promise<T>  // one repair retry on invalid JSON
  ```

- [ ] **Step 1:** Tests with fake providers: `falls through to the next provider on RateLimitError`; `retries the same provider after retryAfterMs when only one provider`; `throws after retries are exhausted with the last error`; `generateJson retries once with a repair prompt on invalid JSON, then throws`; `gemini adapter maps 429 to RateLimitError` (mock `fetch`).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement the adapters over `fetch` (Gemini `generateContent` with `responseMimeType: 'application/json'` when `json`; OpenRouter chat completions, model from `OPENROUTER_MODEL` env defaulting to a `:free` model). **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: llm providers with fallback`.

### Task 6: Chunking, summaries, report generation, quote verification

**Files:** Create `src/pipeline/chunk.ts`, `personas.ts`, `summarize.ts`, `report.ts`, `tests/pipeline/*.test.ts`.

**Interfaces:**
- Consumes: `ParsedChat`, `ChatStats`, `LlmProvider`, `generateJson`.
- Produces:
  ```ts
  interface Chunk { index: number; fromId: number; toId: number; text: string }
  function chunkMessages(chat: ParsedChat, maxChars?: number /* default 24000 */): Chunk[]  // never splits a message, text lines are "HH:MM Sender: text"
  type PersonaId = 'brandon'|'clara'|'diego'
  const PERSONAS: Record<PersonaId, { name: string; system: string }>
  interface ChunkSummary { index: number; events: string[]; jokes: string[]; memberNotes: Record<string, string>; quotes: string[] }
  function summarizeChunk(p: LlmProvider, chunk: Chunk, language: string): Promise<ChunkSummary>
  interface GroupReport { verdict: string; dynamic: string; shiftWeekNote: string; runningJokes: string[]; members: { name: string; opinion: string; quote?: string }[]; advice: string }
  function generateReport(p: LlmProvider, a: { persona: PersonaId; language: string; me: string; stats: ChatStats; summaries: ChunkSummary[]; kind: 'group'|'member'|'followup'; subject?: string; question?: string; retrieved?: string[] }): Promise<GroupReport>
  function verifyQuotes(report: GroupReport, chat: ParsedChat): GroupReport  // drops quotes not present in the chat
  ```

- [ ] **Step 1:** Tests: `chunkMessages never splits a message and respects maxChars`; `chunk ranges are contiguous and cover all messages`; `summarizeChunk validates the JSON shape and rejects missing fields`; `generateReport puts exact stats numbers (starters, busiest day) into the prompt` (assert on the fake provider's captured prompt); `report language is passed through`; `verifyQuotes keeps a quote that is a substring (case/whitespace/bidi-normalised) and drops a made-up one`; `PERSONAS has brandon, clara, diego with distinct systems`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. Persona prompts: Brandon = blunt and funny, no filter; Clara = love-science, kind but truthful; Diego = life coach. All instruct: ground every claim in the supplied stats or summaries, quote only text present in the summaries, answer in the requested language. **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: report pipeline`.

### Task 7: D1 schema and repository

**Files:** Create `migrations/0001_init.sql`, `src/worker/db.ts`, `tests/worker/db.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  // tables: chats(id, name, participants_json, stats_json, created_at, expires_at)
  //         chat_chunks(chat_id, idx, text, summary_json)      -- one row per Chunk
  //         reports(id, chat_id, persona, language, me, kind, subject, question, status, progress, total, content_json, error, share_id, created_at)
  //         rate(key, window, count)
  function createDb(d1: D1Database): {
    insertChat(c: {name: string; participants: string[]; stats: ChatStats; chunks: Chunk[]; expiresAt: number}): Promise<string>
    getChat(id: string): Promise<ChatRow | null>
    getChunks(chatId: string): Promise<ChunkRow[]>
    saveSummary(chatId: string, idx: number, s: ChunkSummary): Promise<void>
    createReport(r: NewReport): Promise<string>
    getReport(id: string): Promise<ReportRow | null>
    updateReport(id: string, patch: Partial<ReportRow>): Promise<void>
    setShare(id: string, shareId: string | null): Promise<void>
    getReportByShare(shareId: string): Promise<ReportRow | null>
    deleteChat(id: string): Promise<void>      // cascades to chunks and reports
    deleteReport(id: string): Promise<void>
    deleteExpired(now: number): Promise<number>
  }
  ```
  Chat text is stored as chunks only (about 40–80 rows for a 1 MB chat), not one row per message.

- [ ] **Step 1:** Tests (pool-workers, real D1): `insertChat then getChunks round-trips`; `deleteChat removes chunks and reports and share lookup returns null`; `deleteExpired removes only expired chats`; `setShare(null) revokes the link`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Write migration and repository (batch inserts). **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: d1 schema and repository`.

### Task 8: API routes, job advancement, rate limit, cleanup

**Files:** Create `src/worker/jobs.ts`, `ratelimit.ts`; modify `src/worker/index.ts`; Test `tests/worker/api.test.ts`, `tests/worker/jobs.test.ts`.

**Interfaces:**
- Consumes: everything above.
- Produces routes: `POST /api/chats` (multipart `file`, returns `{chatId, name, participants, stats: {total, days, firstTs, lastTs}}`); `POST /api/chats/:id/reports` body `{persona, language, me, kind, subject?, question?}` returns `{reportId}`; `POST /api/reports/:id/advance` returns `{status: 'summarizing'|'reporting'|'done'|'failed', progress: number, total: number}`; `GET /api/reports/:id`; `DELETE /api/reports/:id`; `DELETE /api/chats/:id`; `POST /api/reports/:id/share` returns `{shareId}`; `DELETE /api/reports/:id/share`; `GET /api/shared/:shareId`; `scheduled()` calls `deleteExpired`.
  ```ts
  function advanceReport(env: Env, reportId: string, deps?: { provider?: LlmProvider; now?: () => number }): Promise<JobState>
  function checkRateLimit(db, ipHash: string, now: number, limits: {perHour: number}): Promise<boolean>
  ```
  `advanceReport` does at most one LLM call per invocation: summarize the next unsummarized chunk, or, when all are summarized, generate the report, run `verifyQuotes`, and save. Summaries are reused across reports of the same chat (follow-ups skip straight to reporting). LLM failure sets status back to resumable with `error`, not `failed`, until 5 consecutive failures.

- [ ] **Step 1:** Tests: `upload parses a fixture zip and returns participants`; `rejects >10 MB with 413`; `rejects too_small chat with 422 and never calls the provider`; `advance summarizes one chunk per call, then reports, then done`; `a RateLimitError leaves the job resumable and a later advance continues from the same chunk`; `invalid-JSON report retries then marks error after 5 failures`; `second report on the same chat reuses stored summaries (provider call count)`; `rate limit returns 429 after N creates per hour per IP`; `share link works until revoked, then 404`; `scheduled deletes expired chats`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. IP comes from `CF-Connecting-IP`, hashed before storage. **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: api, job advancement, abuse limits`.

### Task 9: Follow-up questions (retrieval)

**Files:** Create `src/pipeline/search.ts`, `tests/pipeline/search.test.ts`; modify `src/worker/jobs.ts`.

**Interfaces:** Produces `function searchChunks(chunks: {idx: number; text: string}[], query: string, k: number): {idx: number; text: string; score: number}[]` (BM25, Hebrew-safe tokenisation: split on whitespace and punctuation, no English stemming).

- [ ] **Step 1:** Tests: `ranks the chunk containing the query terms first`; `tokenises Hebrew and emoji`; `returns at most k results`; `follow-up report passes the retrieved chunks to generateReport` (jobs test with fake provider).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement BM25 and wire `kind: 'followup'` in `advanceReport`. If quality is poor on the real sample, embeddings are a later, separate task. **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: follow-up retrieval`.

### Task 10: UI — landing and setup wizard

**Files:** Create `web/pages/Landing.tsx`, `web/pages/Setup.tsx`, `web/components/*`, `web/styles.css`, `web/api.ts`, `tests/web/setup.test.tsx`.

- [ ] **Step 1:** Finish the visual recon of the real site, read-only: setup steps 2–7 and the footer pages. Stop before any upload or submit, and note each step's fields in `docs/superpowers/specs/ui-notes.md` (commit it).
- [ ] **Step 2:** Tests (Vitest + Testing Library, `fetch` mocked): `wizard walks chat name → upload → who is me → persona → language → start`; `upload errors (too_small, 413) show a plain message`; `the free-tier AI privacy notice is visible on the upload step`; `starting a report stores the ids in localStorage`.
- [ ] **Step 3:** Run, expect FAIL. **Step 4:** Implement the landing page (headline, avatar row, scrolling chat pills with demo reports, own mascot, own copy) and the wizard using `web/api.ts` (`uploadChat`, `createReport`, `advance`). **Step 5:** Run, expect PASS. **Step 6:** Commit `feat: landing and setup wizard`.

### Task 11: UI — report page, history, sharing

**Files:** Create `web/pages/Report.tsx`, `History.tsx`, `Shared.tsx`, `tests/web/report.test.tsx`.

- [ ] **Step 1:** Tests: `report page polls advance until done and shows progress "n of m"`; `an error with a resumable job shows a retry button`; `Hebrew content renders dir=auto`; `share button creates a link and copies it, revoke removes it`; `history lists reports from localStorage and delete calls the API and removes the entry`; `member tabs and the "ask a follow-up" box create new reports`; `shared page shows the report read-only and a clear message for a revoked link`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS. **Step 5:** Commit `feat: report, history, share views`.

### Task 12: Real-sample run and tuning

- [ ] **Step 1:** Run the full stack locally (`wrangler dev` with the user's `GEMINI_API_KEY` in `.dev.vars`, which the user creates) and upload `samples/raw/group.zip`. Generate a Brandon report in Hebrew and one in English.
- [ ] **Step 2:** Check against the real chat: stats match hand-counts for 3 members, every quote is genuine, the report is specific, the RTL view reads correctly. Tune persona prompts and chunk size.
- [ ] **Step 3:** Commit `tune: prompts after real-sample run`.

### Task 13: Deploy to `brandon.amit.rest`

- [ ] **Step 1:** The user runs `! npx wrangler login`. Run `wrangler d1 create`, apply migrations remotely, and set `GEMINI_API_KEY` / `OPENROUTER_API_KEY` as secrets (the user types them via `wrangler secret put`; never in chat).
- [ ] **Step 2:** Add the custom domain `brandon.amit.rest` to the Worker (the zone must be on this Cloudflare account). Deploy.
- [ ] **Step 3:** Smoke test on the live URL: upload the sample, finish a report, create and revoke a share link, delete the chat. Confirm no keys appear in the client bundle (`grep` the built `dist/` for the key prefixes).
- [ ] **Step 4:** Commit `chore: deployment config`.
