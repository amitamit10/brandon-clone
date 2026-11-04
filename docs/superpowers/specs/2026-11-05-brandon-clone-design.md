# Brandon clone — design (2026-11-05)

A free, personal, full-featured version of whatbrandonthinks.com for **WhatsApp group chats only**. The user uploads a WhatsApp group export, and an AI persona ("Brandon") writes a blunt, funny, specific report on the group and on each member. Free LLMs only (Google AI Studio, OpenRouter `:free` models). It is hosted at a subdomain of `amit.rest` through the user's personal Cloudflare account.

## Intent
Personal use with friends. The original is a paid, polished product, and the user wants the same experience without paying. Success looks like this: upload the real group chat, wait a few minutes, and get a report that is specific, accurate and funny enough to share with the group.

## Goals
- Upload a WhatsApp `.zip` or `.txt` export and get a group report.
- Personas: **Brandon** (no filter), **Clara** (love-science, kind but truthful), **Diego** (life coach).
- Group verdict plus an opinion on every member, and a deeper per-member report.
- Facts come from code, not the model: who texts first, message counts, busiest hours and days, the week things changed, longest silences, running jokes, emoji and media habits. The model writes the opinion on top of the facts.
- Follow-up questions about the same chat, each producing a new, deeper report.
- Choice of report language. The chat itself can be in any language (the first sample is Hebrew).
- Report history, delete a chat or a report, and shareable links.
- UI in the style of the original (see below), with an RTL-aware report view.

## Non-goals
- Payments, accounts, email delivery, other chat apps (iMessage, Instagram, etc.), one-to-one chats (maybe later).
- Perfect accuracy on every chat. Reports are entertainment.

## Anti-goals
- Reports that read as generic horoscope text. Every claim should trace to a stat or a quote.
- Hallucinated quotes. Any quote shown must exist in the chat (check in code).
- Keys or chat contents committed to git.
- Silent failures when a free model rate-limits (the user should see progress and retries).

## Constraints
- Free LLM tiers only. Rate limits and quality vary, so the provider layer must support fallback.
- Cloudflare Workers + D1 (personal account). The user logs in with `wrangler` themselves, and no tokens are pasted into chat.
- The app is public with no login (the user's decision). The only abuse limits are per-IP rate limiting, an upload size cap, and auto-delete of chats after N days.
- Free-tier prompts may be used for training by the provider. The UI says so plainly.
- Sample chats in `samples/` are private and git-ignored.

## Sample data findings (the user's real group, Android export)
- Line format: `M/D/YY, HH:MM - Sender: text`, 24h clock, US date order. An iPhone export (`[D/M/YYYY, HH:MM:SS] Sender: text`) is still unseen and must be supported, so the parser is format-detecting.
- About 15.6k lines, about 14.4k messages, 10 senders, 14 months, about 1MB. Far too long for one prompt, so map-reduce is required.
- 1,551 continuation lines (multi-line messages), hidden RTL control characters (U+200E, U+202B, U+202C) around names in system lines, emoji in sender names.
- Placeholders: `<Media omitted>`, `<This message was edited>` (suffix), `This message was deleted`, `You deleted this message`.
- The exporter appears as the account owner in a few system lines ("added you"). The "me" name is a setup-wizard field.
- The zip also holds a `.vcf` contact card, which is ignored. Zip entry names are not reliable UTF-8, so the `.txt` is found by extension.

## Look and feel (from live recon of the homepage; setup steps 2-7 still to confirm)
- White page, large grotesk headline ("Upload a chat. Brandon tells you what's really going on."), grey subline, thick rounded blue "Try It Now →" buttons with a darker bottom edge.
- Row of overlapping circular avatars/platform icons above the headline.
- Three rows of horizontally scrolling chat pills with emoji and short labels ("Family", "The Boys", "Uni crew"). Tapping one shows a demo report.
- Testimonial cards with a carousel and two tags (relationship, platform). Pastel stat tiles (pink, yellow, periwinkle). Wall of shared screenshots.
- Footer with help links. Brand avatar: a man in a fedora and sunglasses (the clone needs its own original avatar, not a copy).
- The clone should copy the structure and feel, not the brand assets or testimonials. Use own mascot, own copy, own demo data.

## Decided by the user
- WhatsApp groups only. Full features. Personal use.
- Hosted at a subdomain of `amit.rest` on the personal Cloudflare account.
- Includes shareable links. No access protection on the app.
- Models: OpenRouter free and/or Google AI Studio. RAG "maybe, we will see".

## Left to the builder (my calls, flagged)
- Stack: TypeScript, Cloudflare Worker with static assets, D1 database, React + Vite UI. API routes run before the assets fallback.
- Parser: pure TypeScript with tests, format-detecting, and strips bidi marks.
- Reports: a job pipeline (parse, stats, chunk-summarize, report), with progress shown on the report page. Chunk summaries are stored, and follow-ups search the stored summaries and message chunks (keyword/BM25 first, embeddings only if needed).
- LLM layer: one interface, Google AI Studio primary, OpenRouter fallback, chosen by env vars. Gemini handles Hebrew well. Free OpenRouter models are less predictable.
- Share links: random 128-bit IDs, revocable, read-only report view.
- Subdomain name: `brandon.amit.rest` unless the user picks another.
- Auto-delete: chats deleted after 30 days by default.

## Open items
- iPhone export sample (optional but recommended).
- Visual recon of setup steps 2-7, with nothing submitted.
- ~~Shared-link name masking~~ Decided by the user: shared links show real member names, no masking.
