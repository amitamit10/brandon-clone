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
