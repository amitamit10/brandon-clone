# Real-site recon notes (whatbrandonthinks.com, 2026-11-05)

Walked through the live wizard in a browser with the user's permission, uploading the user's own WhatsApp sample. I stopped at the email/login-code step (account creation). Nothing was paid for.

## Visual language
- White page, big grotesk headings, grey secondary text. Thick rounded white cards with a light-grey bottom edge ("pressable" look). Primary buttons are blue with a darker bottom edge. After an upload, Continue turns dark grey/black, and it is a lighter grey while disabled.
- Pastel accent colours per item: pink, yellow, green, periwinkle, peach. Each person gets a coloured dot/avatar letter.
- Top bar of the wizard: back arrow, a thin blue progress bar, and "N of 7" on the right.
- Landing: avatar row, headline, scrolling chat pills (emoji + label), "Tap a chat to see a demo", testimonials carousel, pastel stat tiles, screenshot wall.

## Wizard (7 steps)
1. **Chat type** (cards with emoji tile + subtitle): Romantic, Friends group, Any friend, Family, Work / team, Other. The choice goes into the URL (`context=friends-group`).
2. **Source app**: WhatsApp, iMessage, Instagram, Messenger, KakaoTalk, LINE. (Ours: WhatsApp group only, so this step can be dropped or shown as a single fixed choice.)
3. **Upload**: big dashed drop area ("Click to upload / Or drag and drop", ZIP icon), "Your data stays private — Learn more", "See the tutorial" row, disabled Continue. "Can't find your chat file? Send it by email instead."
   - After the upload the drop area becomes a full-card gradient (red/pink/yellow) with a huge message count (**14,038** for our sample), a quality pill ("Excellent signal") and "Click to change the conversation". Hint: "Was this exported without media? WhatsApp includes less history when media is attached."
   - **Tutorial** modal: asks "Which tutorial do you need?" (Chat with one person / Group chat), then an auto-advancing 10-step phone mockup (chat list → group info with member list → Export chat → Without media → save to Files/Downloads → upload on the site), with prev/pause/next and step dots.
4. **Review members**: "Name this group…" (required, with a pencil icon), then a ranked list of senders with coloured dot, name, message count and a percentage bar. Card "Make sure each person appears only once" with a **Merge profiles** button for people who appear under several names or numbers. Continue is disabled until the group has a name ("Name the group to continue").
5. **Clean up the names**: "Replace nicknames and emojis with simple first names, so Brandon knows who's who." One text field per person with a coloured letter avatar.
6. **Report language**: 12 flag buttons (English, Spanish, French, Italian, German, Portuguese BR/PT, Dutch, Indonesian, Hebrew, Arabic, Turkish) plus Other. "It can differ from your chat."
7. **Email**: "Which email address should we send your report to?", then "Send me a code" (email login). Reached but not completed. After this, a free preview, then a paywall and the report (not seen).

## Parser validation
The real site counted **14,038** messages in the sample, and its per-sender counts were 6,170 / 4,186 / 1,628 / 1,170 / 602 / 98 / 87 / 77 / 12 / 8. Our parser (run on the same file) gives **14,039** with identical counts except the second sender (4,187 vs 4,186): one message differs. Worth checking in Task 12 which line it is. Parsing the 1 MB file takes about 18 ms in Node, above the Workers free-plan 10 ms CPU limit (see the ruling in the plan ledger: parse in the browser).

## Additions this implies for our plan
- A **merge profiles** step and a **rename people** step before report generation (Task 10: wizard). The report uses the cleaned names.
- A **message-count / signal-quality** summary after upload.
- A **required group name**.
- A **group-chat export tutorial** modal (our own illustrations/copy).
- Skip: email login, free preview/paywall, other chat apps.

## Motion spec (read from the live site's CSS; recreate with our own code and artwork)
Policy: we copy techniques and timings, not their image assets (mascot, avatars, testimonial photos, screenshot wall) or brand marks. Use our own mascot and generic icons.

| Where | Technique | Values |
|---|---|---|
| Hero avatar cluster | entrance | `cluster-arrive` 0.7s, `cubic-bezier(0.16, 1, 0.3, 1)` (fast out, soft landing) |
| Avatars in the cluster | pop-in with overshoot | `look-in` 0.42s, `cubic-bezier(0.34, 1.56, 0.64, 1)`, one per avatar (7), staggered |
| Behind the cluster | rippling rings | `circle-ripple` 7s ease, infinite, 7 rings with negative delays about 0.12 s apart |
| Chat pill rows | three marquee rows | `drift-left` 54 s, `drift-right` 66 s (delay -9 s), `drift-left` 60 s (delay -18 s); all linear, infinite; the shift is a CSS variable (`--marquee-shift`) |
| Demo area mascot | pulsing halo | `halo` 2.4 s loop; demo content `fade-in` 0.6 s ease |
| Buttons | enter | `cta-enter`: opacity 0→1 and translateY 0.5rem→0 |
| Inputs / errors | feedback | `ink-shake` (±8 px, 5 steps) for invalid; `ink-hop` (−6 px at 30%) for small celebrations |
| Loaders | `spin` (360°), `pulse` (opacity 0.5) | standard |
| Wizard steps / modals | Tailwind-style `enter` utility | fade plus small slide/scale |
Also: honour `prefers-reduced-motion` (stop the marquees and ripples).

## Report and hub structure (seen on the user's own free-preview report, signed in; no payment made)
Structure only. Don't reuse their text. Their UI switched to the report language (Hebrew, RTL).
- **Step 7 after verification:** "Your report will be sent here", a green envelope tile, the email with a check, "Wrong email? Use a different one", and a dark primary button "Create my report" with a soft multicolour glow.
- **Account page** (`/account`): "Your conversations", "Signed in as <email>", one card per chat (emoji tile + name + chevron), and an "Analyze a new conversation" button. A settings gear holds deletion.
- **Conversation hub** (`/c/<uuid>`): a pastel header card (group name, "10 people · 1 report", "All the numbers" link, settings gear). Then a **"Group report" timeline**: report 1 (persona avatar with a number badge, a headline, an arrow), report 2 locked ("Up next", other persona avatar), report 3 as a skeleton. Then a **Participants** list with one row per person (coloured icon + name); per-person reports are locked in the preview.
- **Report page** (`/c/<uuid>/reports/1`): a big serif-like display headline, a witty one-sentence title in the style "X, Y and Z: the official report on <group> (and the <things> along the way)". Then a persona card (avatar, name, tagline), a "Share report" button, a privacy line ("your info stays private, in your control"). Body: a greeting to the group; an opening that states the real message count and date range; then sections with an emoji heading each: (1) a stats section about who writes how much, with counts and percentages, (2) a "profiles" section with a numbered profile per member (name, nickname, emoji), written as roasts, with **real quotes as blockquotes** and a punchline after each. A top-bar button "Analyze another chat".
- **Where the free preview stops:** a "Still ahead" list of locked section titles (each with an emoji) and an "A close look at each person" list (one teaser title per member, nickname-style), then "…". Nothing else is shown without paying.
- **Takeaways for our report format:** (a) a title, (b) an intro grounded in real numbers, (c) several emoji-headed sections, (d) per-member profile with a nickname and quotes, (e) a closing "what would Brandon do". Our `GroupReport` is extended accordingly (see plan ledger).

## Report generation journey (seen live; a report was created with the user's permission)
1. **"Create my report"** (step 7) → the page goes dark.
2. **Reading screen:** a big counter ("12,630 of 14,038 messages") with an orange-to-pink progress bar, over a column of WhatsApp-style chat bubbles (the chat's own messages, incoming grey / outgoing green, with sender names in colours). The brand mascot sits on a glowing horizontal scan line that sweeps down the list as the counter climbs. Bubbles fade at the top and bottom edges.
3. **Stats story, 7 cards** (URL `?show=steps&step=N`, white page, progress bar "N of 7", dark "Continue" button; the last one says "See the report"). Each card is a few pastel tiles:
   1. **"Your years, day by day"**: a dark calendar heatmap, one square per day per month rows (J F M A M J J A S O N D) by year; brighter means more messages.
   2. **"Who talks, who starts"**: *Share of voice* (donut + ranked list with percentages, "Others"), *Who starts the conversation* (horizontal bars, percentages), *What you call each other* (most common address word per person, with counts).
   3. **"Your rhythm"**: a locale-aware tile (here "Shabbats without a single message", 36 of 41), *Record day* (count + date), *Streak* (days in a row), *Longest silence* (days), *By hour* (24 bars, "20% after 10pm · peak at 19").
   4. **"The longest message"**: per top person: word count, date, and a bubble preview with a "See more" expander.
   5. **"It all started here"**: the date and the first five messages as bubbles.
   6. **"And for now, it ends here"**: the date and the last five messages as bubbles.
   7. **"Your words"**: *Laugh print* (per-person count of laugh expressions, record in one go), *Most used words* (top 5, stop-words removed), *Most used emojis* (top 5).
4. **"Brandon is thinking…" screen** (`?show=writing`): the mascot in a rainbow halo, small coloured dots orbiting, a thinking-face badge, shimmering text, a cyan→purple→red gradient progress bar, "Your report should appear in under 2 min."
5. **Report page:** editorial **serif display headline** (high-contrast serif), then a persona card ("AI with no filter, too many opinions and an unexplained fondness for lasagna"), a **Share the report** button, the privacy line, then the body in a readable sans. The report is written in the chosen language, with names in the chat's own script. After it finishes, an email goes to the user.

### Plan changes this implies
- **Task 4b (stats extras)** for the story cards: calendar heatmap data (per-day counts), streak (longest run of consecutive days), quiet-day count (generalise the Shabbat tile: "weekends/holidays with no messages" is locale-specific, skip it), nicknames (most common word following a name/at the start of a message per person, optional), longest message per person, first 5 and last 5 messages, laugh counts per person (safe, linear matcher for "lol/haha/חח"), top words (stop-word lists per language, start with simple), top emojis (done).
- **Task 10/11 UI:** reading screen with the live counter, the 7-card story (it also hides the wait while the job runs), the "thinking" screen, and the report page with serif headline.
- Our job runs one LLM call per `advance`, so the reading counter can show real chunk progress ("chunk 12 of 40").
