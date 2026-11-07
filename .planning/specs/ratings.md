# Spec: Tool ratings

Status: requested by the owner on 2026-11-07 ("Build ratings").

## Goal
Collect honest 1–5 star ratings from people who used a tool, show the average on the tool page, and give Google the same numbers so the result can show stars. Ratings are never invented or seeded.

## Behaviour
- **Asking.** On the result screen, under the summary in the result card: "How was Merge PDF?" with five star buttons. Only built tools ask. One tap sends the rating, with no sign-in.
- **After rating.** The stars stay filled to the chosen score and the text says "Thanks! You rated it 4 out of 5." Tapping another star changes the rating; it never adds a second one. A failed send says so and lets the person try again.
- **Remembering.** The browser keeps a random voter id (`anytools-voter`) and the chosen score per tool (`anytools-rated`), created only when someone rates. A returning visitor sees their previous rating.
- **Showing.** Once a tool has at least 5 ratings, its page shows "4.8 out of 5 · 23 ratings" with stars under the title, and its WebApplication data gets an `aggregateRating`. Fewer than 5 ratings show nothing, so the page never says "5.0 from 1 rating".
- **Freshness.** Scores are baked into the static pages when the site is built, so showing them costs nothing per visit and never shifts the layout. They refresh on every deploy.

## Server
- A Cloudflare Worker runs only for `/api/*`; every other request is still served as plain files, free and unlimited.
- `GET /api/ratings` → `{ "merge-pdf": { "count": 23, "average": 4.78 } }` for all built tools. Used by the build.
- `POST /api/ratings/{slug}` with `{ "score": 1-5, "voter": "<uuid>" }` → the tool's new `{ count, average }`.
  - Only built tools, scores 1–5 and well-formed voter ids are accepted.
  - Only requests whose `Origin` is the site itself.
  - The same voter rating again replaces their earlier score.
  - At most 20 new ratings per IP address per tool per day.
- Storage: Cloudflare D1 (free tier), table `ratings(tool, voter, score, ip_day, created_at, updated_at)`, timestamps in UTC ISO 8601.
- **Privacy.** The voter id is stored only as a salted hash. The IP address is never stored; only a salted hash of IP + tool + UTC date (`ip_day`), used for the daily limit, which can't be traced back. The salt is the secret `RATING_SALT`; without it the API refuses to store anything. Nothing goes to Google Analytics.

## Build
- In Cloudflare builds (`WORKERS_CI=1`) the site fetches `https://anytools.fyi/api/ratings` once, with a 5-second timeout. If it fails, the build carries on without ratings.
- `RATINGS_FILE=<path>` makes the build read a local JSON file instead, for tests.

## Pages
- Privacy policy: a "Ratings" section saying what is stored.
- Cookies page: the two new browser storage keys.

## Not in scope
- Written reviews, ratings on tool cards, or ratings for tools that aren't built.
