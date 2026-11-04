// Cloudflare FREE-plan limits that drive the step-per-LLM-call job design
// (read from developers.cloudflare.com on 2026-11-05):
//   Workers: 50 subrequests/invocation, 10 ms CPU/request (time awaiting fetch/D1 is NOT CPU),
//            cron triggers allowed (5/account), 100k requests/day.
//   D1:      100k rows written/day, 5M rows read/day, 500 MB/db, 2 MB max row/value,
//            100 bound params/query, 50 queries/invocation, 100 KB max SQL statement.
// Consequences: each `advance` call does ONE LLM call; chats are stored as ~24 KB chunk
// rows (never one row per message); batch inserts must stay under 100 bound params/query.
// Risk: parsing+stats of a ~1 MB chat may exceed 10 ms CPU. Measure in Task 12; fallback is
// to parse in the browser (parser is pure TS) or use Workers Paid.
export {}
