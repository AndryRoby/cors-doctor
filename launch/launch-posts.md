# Launch posts — CORS Doctor

Research date: 2026-09-06. Tool: https://arling.sk/cors-doctor/

Method: GitHub REST search API (`api.github.com/search/issues`) for the tool's
own error message ("has been blocked by CORS policy") and for each named
repo/framework, GitHub's own Discussions search
(`github.com/<org>/<repo>/discussions?discussions_q=...`) for the frameworks
that have Discussions enabled, and an attempt at Stack Overflow (blocked, see
note under §1.5). Every thread below was actually fetched (via the REST API
or by reading the live page); nothing here is invented. Dates are UTC, from
each thread's own API/page data.

**Rule applied:** closed issue/discussion with its last activity more than 12
months ago → skip. Open/unanswered threads are judged on relevance and
whether a reply would look welcome (a live troubleshooting thread with a real
unanswered question) vs. unwelcome (an internal task tracker or library
architecture debate between a reporter and a maintainer, or a case already
resolved).

---

## 1. Findings

### 1.1 Broad search: `"has been blocked by CORS policy" is:issue`, sorted by updated / by comments

This exact phrase is common enough (12,126 total matches) that the top of
both sort orders is dominated by unrelated hits, browser-automation test
suites whose titles happen to contain the phrase, internal task trackers,
and issues where the phrase appears in an unrelated log dump. All of the
below are **skip**, with one exception investigated in depth:

| Repo / issue | State | Last activity (UTC) | Recommendation |
|---|---|---|---|
| [treflehq/trefle-api#91](https://github.com/treflehq/trefle-api/issues/91) — "CORS error when calling the API from the client side with a JWT" | closed 2026-09-04 | opened 2021-03-11, closed same day as this search | Skip — closed, and closed the same day it resurfaced (likely a stale-issue bot sweep), no open question to answer. |
| [sebadob/rauthy#1710](https://github.com/sebadob/rauthy/issues/1710) — "OPTIONS /users/register preflight response missing Access-Control-Allow-Headers" | closed 2026-09-04 | opened 2026-09-01 | Skip — closed same week as opened; the maintainer (also the sole author of this identity-server project) fixed it directly, nothing open to reply to. |
| [expressjs/cors#305](https://github.com/expressjs/cors/issues/305) — "`OPTIONS` request handler missing `Allow` header" | open, 16 comments | 2026-08-02 | Skip — a bug report against the library's own internals, discussed with the maintainer; not an app developer's troubleshooting thread. |
| [expressjs/cors#333](https://github.com/expressjs/cors/issues/333) — "CORS requests with credentials should forbid `*`" | open, 4 comments | 2026-03-19 | Skip — a feature request asking the library to add its own validation for exactly the mistake CORS Doctor flags; a stranger's tool link doesn't fit a library design discussion. |
| [expressjs/cors#422](https://github.com/expressjs/cors/issues/422) — "Add a note in the docs about `origin: true` and `credentials: true` being dangerous" | open, 1 comment | 2026-07-23 | Skip — same reason, a docs-improvement request to the maintainer. |
| [adamchainz/django-cors-headers#578](https://github.com/adamchainz/django-cors-headers/issues/578) — "Django 3.1: CORS headers not set on error responses?" | open, 8 comments | last real comment 2023-04-12 (the "updated" timestamp is newer, likely a label/bot touch, not new discussion) | Skip — verified in full: a real, still-open library limitation (`CorsMiddleware` doesn't run on `process_exception`), but it's a maintainer/contributor architecture thread about fixing the library itself, not something a config change (or this tool) resolves for an individual user. |
| [nitrojs/nitro#1100](https://github.com/nitrojs/nitro/issues/1100) — "The 'Access-Control-Allow-Origin' header contains multiple values '\*, \*'" | open | opened 2023-03-30, still open | Skip — verified in full: a real, distinct bug class (duplicate CORS headers from double-registered route rules) that CORS Doctor doesn't check for, and Nitro/Nuxt isn't one of the stacks this tool targets. |
| [dotnet/aspnetcore#22281](https://github.com/dotnet/aspnetcore/issues/22281) — "CORS header not being set for internal server error response" | open, 6 comments | 2026-07-21 | Skip — same "headers missing on the error path" pattern as the Django one above, but again the official framework repo's own tracker, discussed by framework contributors, not an app developer's thread. |
| [dotnet/aspnetcore#23218](https://github.com/dotnet/aspnetcore/issues/23218) — "It is not clear that UseCORS must come before UseResponseCaching" | open, 7 comments | 2026-05-01 | Skip — a docs-clarity request to the ASP.NET Core team. |
| [supabase/supabase#41334](https://github.com/supabase/supabase/issues/41334) — "Supabase Edge Functions truncate headers, breaking CORS for custom headers" | open, 2 comments | 2026-06-03 | Skip — a platform bug report filed against Supabase itself (the fix has to happen on their side), not a config mistake an individual developer can act on. |
| [supabase/supabase#42033](https://github.com/supabase/supabase/issues/42033) — "REST API ignores PostgREST CORS settings, forcing Access-Control-Allow-Origin: \*" | open, 3 comments | 2026-06-05 | Skip — same reason, a platform-side bug report. |
| [cloudflare/workers-sdk#14683](https://github.com/cloudflare/workers-sdk/issues/14683) — "wrangler dev rewrites in-Worker Host/Origin/request.url ... breaking origin-based auth/CORS checks" | open, 1 comment | 2026-07-31 | Skip — a local-dev-tooling bug report against `wrangler`, not a production CORS misconfiguration. |
| honojs/hono — several closed CORS issues (#5159, #4904, #4811, #4471) | all closed | 2026-02 to 2026-07 | Skip — all closed, all library-internals bug reports/feature requests, not troubleshooting threads. |
| Everything else in both the updated-sort and comments-sort top 15 (bot/CI issues, unrelated log-noise matches, internal roadmap items) | mixed | 2026-06 to 2026-09 | Skip — no genuine CORS question to answer. |

### 1.2 GitHub Discussions — `fastapi/fastapi`

| Discussion | Status | Posted | Recommendation |
|---|---|---|---|
| [#14491 — "CORS tutorial example violates CORS restrictions on use_credentials"](https://github.com/fastapi/fastapi/discussions/14491) | marked unanswered, 1 real reply | 2025-12-10 | Skip — verified in full: a maintainer (YuriiMotov) already confirmed it and linked the fix PR (#14115) the next day. Already handled. |
| [#14313 — "CORS Middleware and exception handler"](https://github.com/fastapi/fastapi/discussions/14313) | marked unanswered, 11 replies | 2025-11-08 | Skip — verified in full: a deep, already-resolved back-and-forth between the reporter and a maintainer about FastAPI's own middleware-ordering design (CORSMiddleware vs. exception-handling middleware); genuinely interesting context (used in §2 below to inform the article), but not a spot for an outside tool link. |
| [#13496 — "Cookies not being received in endpoint with prefix"](https://github.com/fastapi/fastapi/discussions/13496) | unanswered, 2 replies | 2025-03-18 | **Post** (see §2.3). Verified in full: genuinely stuck after 2 replies, neither of which lands on the real cause; the OP's own clarifying detail ("works on localhost, not hosted") points straight at a credentialed cross-origin CORS issue rather than a routing bug. |
| [#9564 — "Fast API @get is responding to OPTIONS requests..."](https://github.com/fastapi/fastapi/discussions/9564) | closed, 1 reply | 2023-05-23 | Skip — verified in full: already correctly answered, and closed >12 months. |
| #6367, #9027, #9391, #10197, #7741 — various closed CORS discussions | all closed | 2020–2023 | Skip — closed >12 months, and titles/metadata indicate low engagement (0–4 replies) on old FastAPI versions. |

### 1.3 GitHub Discussions — `vercel/next.js`

| Discussion | Status | Posted | Recommendation |
|---|---|---|---|
| [#64115 — "CORS is causing hell in App Router"](https://github.com/vercel/next.js/discussions/64115) | **unanswered**, 5 replies | 2024-04-05 | **Post** (see §2.1). Verified in full, code and error message included: five different people (through mid-2025) confirm the same failure and none of the proposed fixes (including the one currently at the top) actually addresses a "missing Access-Control-Allow-Origin" error — genuinely still open. |
| [#61451 — "Redirect from route handler blocked by CORS policy"](https://github.com/vercel/next.js/discussions/61451) | **unanswered**, 6 replies | 2024-01-31 | **Post** (see §2.2). Verified in full: six separate "same issue / any solution?" replies over nearly two years, with only a workaround mentioned once, never the underlying mechanism (cross-origin redirect following in `fetch()`) explained. |
| [#96770 — "Startup not firing on remote domain"](https://github.com/vercel/next.js/discussions/96770) | unanswered, 6 replies | 2026-08-05 | Skip — verified in full: about `assetPrefix`/chunk-loading through an iframe proxy, CORS is mentioned only in passing as one possible mitigation; not the class of bug this tool addresses. |

### 1.4 GitHub Discussions — `supabase/supabase`

Searched `discussions_q=CORS`; every relevant, recently-active result returned
is actually about the OAuth "redirects to localhost in production" family of
bugs (already covered by the Google OAuth Redirect Doctor and Supabase
Redirect Doctor sibling tools' own launch research), not a CORS
header/preflight misconfiguration. No new candidate for this tool.
Everything else returned is an official Supabase announcement/runbook post
(Grafana dashboards, pg_cron, disk I/O), not a question thread at all.
**No post.**

### 1.5 Stack Overflow

Could not be queried — `stackoverflow.com` is blocked to this session's
fetcher (network/robots restriction on the fetching tool, not a missing
result), same as on the previous tool's launch research. Andrej: check
manually at
`https://stackoverflow.com/search?q=%22has+been+blocked+by+CORS+policy%22&tab=Newest`
for anything to add — nothing from there is included below because it
couldn't be verified live.

---

## 2. Drafted replies (first person, as Andrej)

Post these only where the thread is still open for replies. Each is a real
technical answer to the actual question, and ends with exactly one sentence
pointing at the tool.

### 2.1 → https://github.com/vercel/next.js/discussions/64115

> Looking at the code posted above: the actual failure here is almost certainly not about the `OPTIONS` handler at all. Your browser error is specifically "No 'Access-Control-Allow-Origin' header is present," which is what you get when the *response the browser actually reads* has no CORS headers on it, not what you get from a failed or missing preflight (that throws a different, preflight-specific error). A few things worth checking in order:
>
> 1. Open the Network tab and look at the `POST` request specifically, not the `OPTIONS` one. What's its status code? If it's a 500, or anything other than the 201 your success-path `return new Response(...)` sends, your route handler is throwing before it reaches that return statement, and whatever error page Next.js renders for an uncaught exception in a route handler doesn't carry the `Access-Control-Allow-Origin` header you hand-added only on the success path. That's the single most common way to get exactly this error message despite the header being "right there in the code."
> 2. Check whether you have a `middleware.ts` matching `/api/example` (or a broader matcher that includes it). Middleware runs before your route handler; if it returns or rewrites a response for this path, your route handler (and its headers) never runs at all.
> 3. Narrowing `Access-Control-Allow-Methods` to just `"POST"`, as suggested above, won't fix a missing-header error. That header only affects what the preflight declares as allowed; it has no effect on whether the *actual* response carries `Access-Control-Allow-Origin`.
>
> I put together a free tool that walks through exactly this distinction (what the preflight response needs vs. what the actual response needs) if it helps narrow down which of the two is missing the header once you've checked the Network tab: https://arling.sk/cors-doctor/

### 2.2 → https://github.com/vercel/next.js/discussions/61451

> This isn't the same class of bug as a missing `Access-Control-Allow-Origin` header, it's what happens when `fetch()` follows a cross-origin redirect. When your route handler answers with `NextResponse.redirect(checkoutSession.url)` and your client code calls that route handler with `fetch()` (not a full-page navigation), the browser's default `redirect: 'follow'` behavior means it transparently follows the 307/308 to Stripe's checkout URL, then applies the *same* CORS check to Stripe's response that it applied to your route handler's response. Stripe's checkout page is built to be navigated to directly in the browser, not fetched via JS from an arbitrary origin, so it (correctly, from Stripe's side) sends no `Access-Control-Allow-Origin` permitting your origin to read it via `fetch()`, and the browser reports the whole chain as one CORS failure.
>
> Server actions don't hit this because `redirect()` inside a server action is carried back to the client as a navigation instruction over the action's own response channel; it never asks the browser's `fetch()` to follow an external redirect on its own.
>
> The workaround already mentioned above (return the URL as JSON, then redirect on the client with `window.location.href` or a full-page form submission instead of `fetch()`) is the correct fix, not a hack: once a redirect is meant to leave your app entirely, it needs to be a real browser navigation, not something a cross-origin `fetch()` call follows on your behalf.
>
> A different failure mode from the classic missing-header case, but if it's useful for comparing preflight vs. actual-response headers on any of your other API routes, I built a free client-side tool for that: https://arling.sk/cors-doctor/

### 2.3 → https://github.com/fastapi/fastapi/discussions/13496

> The router prefix is very unlikely to be the actual variable here (you'd expect a routing bug either way), but the detail that it's specifically "works on localhost, not in hosted environments" points somewhere else: locally, front end and API are almost certainly on the same site (same registrable domain, maybe different ports), so a `SameSite=None; Secure` cookie round-trips without much friction. In a hosted environment, if front end and API sit on genuinely different domains, that's a real cross-site request, and it's worth confirming, on the *actual* (non-`OPTIONS`) response for the prefixed endpoint specifically, that `Access-Control-Allow-Origin` echoes back the exact request origin (never `*`, which the spec forbids once credentials are involved) and that `Access-Control-Allow-Credentials: true` is present. A CORS check failing on a credentialed cross-origin response makes the browser discard the whole response, `Set-Cookie` included, before your JS ever sees it, even though the server did send it, which looks exactly like "cookies aren't being received."
>
> Also worth checking: does the prefixed router (or a mounted sub-application) skip your global `CORSMiddleware` somehow, either because it's added before the middleware is registered, or because it's a separate `FastAPI()`/`APIRouter` instance than the one the middleware is attached to?
>
> I built a free tool that diffs a request's actual response headers against what CORS requires for a credentialed cross-origin request, handy for confirming whether it's the header on this one endpoint rather than the cookie itself: https://arling.sk/cors-doctor/

---

## 3. Facts for the owner (for Andrej's own post)

1. Free, static HTML plus one dependency-free JS file, no backend: nothing typed into the form (origin, request, response headers) ever leaves the browser.
2. Checks 7 distinct CORS failure patterns: missing `Access-Control-Allow-Origin`, wildcard origin combined with a credentialed request, an origin value that doesn't match the page (scheme/subdomain/port), a preflight that's required but missing or failed, a header the request sends that isn't in the preflight's allow-list, a preflight response that's itself a redirect, and a preflight answered with a 4xx/5xx status.
3. Every rule is sourced from and cross-checked against MDN's CORS reference, MDN's CORS error reference, the WHATWG Fetch Standard's own HTTP CORS protocol section, and the official docs for Express's `cors` middleware, FastAPI's `CORSMiddleware`, and `django-cors-headers`.
4. Built for developers on any stack: React/Vite/Next.js front ends calling Express, FastAPI, Django, Rails, Laravel, Go, .NET, Supabase, Firebase Functions, S3, Cloudflare Workers, or a third-party API.
5. Built after a live GitHub issue/discussion search (2026-09-06) turned up two multi-year-old Next.js discussion threads (5 and 6 separate people, respectively, confirming the same unresolved CORS failure) that no one had actually diagnosed correctly yet.
6. No account and no email required to use the tool; the "tell me about new tools" email signup on the page is entirely separate and optional.
7. Source is public: https://github.com/AndryRoby/cors-doctor. Same "all rights reserved, hosted use is free, no rehosting" notice as every other ARLing tool.
8. Sixth tool in the same free "Doctor" series (Google OAuth redirects, Supabase/Flutter/Expo auth redirects, Stripe webhook signatures, and now CORS): same static page, same no-account approach, same self-hosted Umami analytics with no cookies and no personal data collected.

---

## 4. Article outline

**Working title:** *"has been blocked by CORS policy": the seven checks that actually catch it*

1. **The hook** — the browser's own error message tells you almost nothing (which header, whose response, preflight or real request); here's what actually causes it, in the order it's worth checking.
2. **What CORS actually is, in one paragraph** — enforced entirely client-side by the browser reading response headers; a request that works in Postman or curl proves nothing, since neither tool enforces it (cite MDN's CORS overview).
3. **The seven real causes, one section each:**
   - Missing `Access-Control-Allow-Origin` entirely (the most common case).
   - `Access-Control-Allow-Origin: *` on a credentialed request (spec requires an exact origin, `Access-Control-Allow-Credentials: true`, and ideally `Vary: Origin`).
   - An origin value that's present but doesn't match, scheme, `www` vs. apex, or port.
   - A request that needed a preflight and didn't get a clean one, what actually triggers a preflight (non-`GET`/`HEAD`/`POST`, a non-safelisted header, `Content-Type: application/json`).
   - A header the real request sends (`Authorization`, most often) missing from the preflight's `Access-Control-Allow-Headers`.
   - A preflight response that's a redirect (browsers refuse to follow it).
   - A preflight answered with a 4xx/5xx, the classic "no explicit `OPTIONS` route" bug across Express, FastAPI, and friends.
4. **The one everyone gets wrong: CORS headers missing on error responses** — tie together the FastAPI, Django (`django-cors-headers`), and ASP.NET Core threads found during launch research (§1.1–1.2), all independently hitting the same architecture gotcha: CORS headers added by hand on a success path, or by middleware that never sees exception responses, silently vanish exactly when a developer needs to see the real error most.
5. **The redirect trap** — `fetch()` following a cross-origin redirect (e.g. an app route handler redirecting to a payment provider's hosted checkout) applies CORS to the *final* response too; link the worked case from the Next.js discussion (§2.2) and the fix (a real browser navigation, not `fetch()`, once the destination is external).
6. **A checklist you can run by hand** — or the free tool that automates the diff (link at the end, not before).
7. **Sources** — link every official doc cited in step 2 and step 3, so the article holds up to scrutiny: MDN CORS, MDN CORS errors, WHATWG Fetch Standard, Express `cors`, FastAPI `CORSMiddleware`, `django-cors-headers`.
