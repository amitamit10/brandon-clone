# Deploying to brandon.amit.rest (Cloudflare Workers + D1)

Everything below runs on the **free** Cloudflare plan. You run the login and secret commands yourself; nothing here needs a token pasted into a chat.

## 0. Before you start
- The domain `amit.rest` must be a zone in your personal Cloudflare account.
- Rotate any key you pasted into a chat: delete it in Google AI Studio / OpenRouter and create a fresh one for production.

## 1. Log in (you run this)
```
! npx wrangler login
```
(The `!` prefix runs it in this Claude Code session so the browser login completes.)

## 2. Create the database and apply migrations
```
npx wrangler d1 create brandon
```
Copy the printed `database_id` into `wrangler.jsonc` (replace `local-placeholder`), then:
```
npx wrangler d1 migrations apply brandon --remote
```

## 3. Secrets (you type each value when prompted)
```
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_TOKEN        # at least 24 random characters, e.g. from: openssl rand -hex 24
npx wrangler secret put VISITOR_SECRET     # a different random value, at least 24 characters
```
Non-secret settings go in `wrangler.jsonc` under `vars`:
```
"vars": { "LLM_PRIMARY": "openrouter" }
```
Optional: `OPENROUTER_MODEL` (default `stealth/crouton-alpha`) and `GEMINI_MODELS` (comma-separated).
`ADMIN_TOKEN` and `VISITOR_SECRET` must be two different values. Without `VISITOR_SECRET` visitor counting is off; without `ADMIN_TOKEN` the admin pages do not exist.

## 4. Custom domain
Add to `wrangler.jsonc`:
```
"routes": [{ "pattern": "brandon.amit.rest", "custom_domain": true }]
```
Wrangler creates the DNS record and certificate for the subdomain automatically (the zone must be in the same account).

## 5. Build and deploy
```
npm run build
npx wrangler deploy
```

## 6. Smoke test on the live URL
1. Open `https://brandon.amit.rest/`, upload a sample, finish a report, create and stop a share link, delete the chat.
2. Open `/admin`, log in with `ADMIN_TOKEN`.
3. Check the built files contain no keys: `grep -rE "sk-or-|AQ\.|AIza" dist/` must print nothing.

## Things to know on the free plan
- Worker CPU is 10 ms per request (time spent waiting on the AI or the database does not count). Parsing and statistics run in the visitor's browser for that reason. The final report step rebuilds the messages and checks quotes inside the Worker: measure it on the live site with a large chat (`npx wrangler tail`). If it exceeds the limit, the fix is to move quote checking to the browser or use the $5 Workers Paid plan.
- D1 free limits: 100,000 rows written per day, 50 queries per request. A 14,000-message chat is about 24 chunk rows.
- The AI providers are free tiers: Gemini may use prompts for training, `stealth/crouton-alpha` may retain them. The site says so on the landing page, the upload step and the last step.
- Chats and reports are deleted after 30 days by the nightly cron (`0 3 * * *`).
