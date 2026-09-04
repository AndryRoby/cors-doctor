# CORS Doctor

A free tool that finds why a browser is throwing "has been blocked by CORS policy" in the console, and gives the exact fix, for your backend and for your front end.

Live: https://arling.sk/cors-doctor/

You paste the page's origin, the request (method, headers, body content type), and the response headers your backend actually sent (from the Network tab, both the preflight `OPTIONS` response if there was one, and the actual response). The tool works out whether the browser needed a preflight at all, diffs the response headers against what the CORS protocol requires for that exact request, and reports the precise header or value that's wrong.

## What it checks

Each check below is a `code` the engine (`doctor-cors.js`) can return from `diagnose()`, either from the structured fields you fill in or, for the ones marked "(from pasted error)", parsed straight out of a browser console error you paste in verbatim:

- `missing_acao`: the response has no `Access-Control-Allow-Origin` header at all. The single most common cause of "No 'Access-Control-Allow-Origin' header is present on the requested resource."
- `multiple_acao_values`: the response sends more than one `Access-Control-Allow-Origin` value in a single header (a comma-joined list), which browsers reject outright; exactly one value, or `*`, is allowed.
- `acao_origin_mismatch`: `Access-Control-Allow-Origin` is present but doesn't byte-for-byte match the page's origin, whether the header holds a different origin outright or differs only in scheme (`http` vs `https`), subdomain (`www` vs. apex), or port, each a distinct origin to a browser.
- `acao_null_origin`: `Access-Control-Allow-Origin` is the literal string `"null"`, which only matches a request whose own `Origin` is `"null"` (a sandboxed iframe, a `file://` page), not a normal `https://` page.
- `acao_wildcard_with_credentials`: the response sends `Access-Control-Allow-Origin: *` while the request carries credentials (`fetch(..., { credentials: 'include' })`, `xhr.withCredentials = true`, or an ambient cookie). The spec forbids pairing a credentialed request with the wildcard; the response must echo back the exact origin instead, plus `Access-Control-Allow-Credentials: true` and, ideally, `Vary: Origin`.
- `missing_acac`: the request carries credentials, `Access-Control-Allow-Origin` already matches the page origin, but `Access-Control-Allow-Credentials` is missing or isn't exactly the string `true`.
- `vary_origin_missing`: `Access-Control-Allow-Origin` reflects a specific origin (not `*`), which usually means the server allow-lists or echoes the caller's `Origin`, but the response has no `Vary: Origin`, so a shared/CDN cache can serve one origin's cached response to a different origin.
- `preflight_status_not_ok` / `preflight_status_unknown`: the request needs a preflight (see below) and the `OPTIONS` response either never showed up in what you entered, or came back with something other than a 2xx, most often because auth middleware, a catch-all router, or a WAF intercepts `OPTIONS` before any CORS handler runs.
- `preflight_missing_acam` / `method_not_in_acam` / `acam_wildcard_with_credentials`: the preflight succeeded but its `Access-Control-Allow-Methods` is missing entirely, doesn't list the method the real request uses, or is `*` on a credentialed request (not honored there, must be an explicit list).
- `preflight_missing_acah` / `header_not_in_acah` / `acah_wildcard_with_credentials`: same three variants for `Access-Control-Allow-Headers`, most often triggered by a custom `Authorization` header, which is never CORS-safelisted and must be explicitly allow-listed.
- `preflight_redirect`: the request needs a preflight and the actual request (or the preflight itself) redirects to a different origin; browsers refuse to follow a redirect for a preflighted request at all.
- `error_status_no_cors_headers`: the actual response status is 4xx/5xx and carries no `Access-Control-Allow-Origin`. A lot of frameworks only attach CORS headers on the success path, so the browser's CORS error may just be surfacing a real server error underneath, not a separate misconfiguration.
- `localhost_vs_loopback_ip`: the page and the request (or the page and `Access-Control-Allow-Origin`) use `localhost` on one side and `127.0.0.1`/`[::1]` on the other; a browser treats these as unrelated hosts even though both are loopback.
- `samesite_none_secure_needed`: credentials are included and the API is on a different host than the page (a genuine cross-site request), which means any cookie needs `Set-Cookie: ...; SameSite=None; Secure` or the browser drops it regardless of what the CORS headers say.
- `not_http`, `preflight_status_not_ok` *(from pasted error)*: Chrome/Edge/Firefox's own console phrasing ("CORS request not http", "the CORS preflight channel did not succeed", and the rest of the [MDN CORS error catalogue](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS/Errors)) is pattern-matched from a pasted error message, so a diagnosis is possible even before you've filled in the structured fields.

The engine also computes the expected header values and a copy-paste server snippet for 11 stacks: Express (`cors` middleware), FastAPI (`CORSMiddleware`), Django (`django-cors-headers`), Rails (`rack-cors`), Laravel, Go (`net/http`), .NET/ASP.NET Core, Supabase Edge Functions, Firebase Cloud Functions, Cloudflare Workers, and an Amazon S3 bucket CORS configuration.

## What it does not do

- It does not call your backend, your front end, or any live API. It only compares the values you type in against each other and against the CORS protocol's own rules.
- It does not proxy your request, bypass CORS, or "fix" anything for you at runtime; it tells you which header to add or change and where.
- It does not send, store, or log your configuration anywhere. There is no account, no login, and no payment wall.
- It does not know about a CORS misconfiguration that only manifests on your specific server framework version, or a rule the CORS/Fetch specification has changed since this was last updated (see Sources below).

## How it works

Everything runs in your browser. `doctor-cors.js`, one dependency-free JavaScript file, exports a single pure function, `diagnose(config)`, which the page calls with the values you fill in and renders the result as a plain-language report. Nothing about your request or response headers is sent anywhere; the only network activity is loading the page's own static assets and anonymous Umami analytics events (see Privacy).

```js
import { diagnose } from './doctor-cors.js';

const result = diagnose({
  request: {
    pageOrigin: 'https://app.example.com',
    requestUrl: 'https://api.example.com/v1/orders',
    method: 'POST',
    credentials: 'omit',
    customHeaders: ['Authorization'],
    contentType: 'application/json',
  },
  response: {
    acao: 'https://app.example.com',
    acam: 'POST, OPTIONS',
    acah: 'Content-Type',
    vary: 'Origin',
    preflightStatus: 204,
  },
  server: { stack: 'express' },
});
```

Output (this is the tool's actual output, run against the code above, not a hypothetical):

```json
{
  "status": "fail",
  "summary": "1 blocking mismatch found. Most urgent: Header \"Authorization\" the request sends is not in Access-Control-Allow-Headers (\"Content-Type\").",
  "problems": [
    {
      "severity": "high",
      "code": "header_not_in_acah",
      "message": "Header \"Authorization\" the request sends is not in Access-Control-Allow-Headers (\"Content-Type\").",
      "path": "response.acah",
      "value": "Content-Type",
      "fix": "Add \"Authorization\" to Access-Control-Allow-Headers."
    }
  ],
  "expected": {
    "acam": "POST, OPTIONS",
    "acah": "Authorization, Content-Type",
    "snippet": "const cors = require('cors');\n\napp.use(cors({\n  origin: 'https://app.example.com',\n  credentials: false,\n  methods: 'POST, OPTIONS',\n  allowedHeaders: 'Authorization, Content-Type',\n}));\n// cors() must run before your routes and before any auth middleware\n// that could otherwise 401/redirect the OPTIONS preflight itself."
  },
  "disclaimer": "Read-only, client-side analysis of the values you entered. Nothing is verified against your live server: always confirm with your browser's Network tab and your server logs before shipping a fix."
}
```

(`expected` is trimmed above for readability; the full object also carries `needsPreflight`, `preflightReasons`, `acao`, `acac`, and `stackLabel`, and the actual result carries a `fixes` array and a five-item `checklist` alongside `problems`.)

Everything else about this request checks out: the origin matches, the preflight itself succeeded, the method is allow-listed. It's one header value on one response the tool catches, instead of you re-reading the same two panels in DevTools, and `expected.snippet` hands you the exact Express change to make.

## Run locally

No build step, no dependencies.

```bash
git clone https://github.com/AndryRoby/cors-doctor.git
cd cors-doctor
python -m http.server
# or just open index.html directly in a browser
```

## Tests

```bash
node tests.mjs
```

107 assertions, 107 passed, 0 failed as of this writing.

## Privacy

Everything runs client-side; nothing you type into the form is sent anywhere, ever. Product analytics (page views, "run check" clicked) go to a self-hosted Umami instance with no cookies and no personal data, event name and count only. Joining the "tell me about new tools" email list on the page is entirely optional and separate from using the tool. Full policy: https://arling.sk/privacy/.

## Sources

The rules this tool checks are drawn from:

- MDN: [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- MDN: [CORS errors](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS/Errors)
- WHATWG Fetch Standard: [HTTP CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol)
- Express: [`cors` middleware docs](https://expressjs.com/en/resources/middleware/cors.html)
- FastAPI: [CORS (Cross-Origin Resource Sharing)](https://fastapi.tiangolo.com/tutorial/cors/)
- `django-cors-headers`: [configuration reference](https://github.com/adamchainz/django-cors-headers)

## Report a problem

Found a CORS failure this tool doesn't catch, or a check that flags something that's actually fine? Open an issue: https://github.com/AndryRoby/cors-doctor/issues, or write to andrej@arling.sk. Please redact anything sensitive (API keys, internal hostnames, tokens) before posting; issues are public.

## License

All rights reserved, see [LICENSE-NOTICE.md](LICENSE-NOTICE.md). Reading the source and learning from it is fine; deploying your own copy of it as a competing product is not.

---

ARLing s. r. o., Bratislava, Slovakia. andrej@arling.sk

Hub (more free tools): https://arling.sk/

Sibling tools:
- Google OAuth redirect_uri_mismatch: https://arling.sk/google-oauth-redirect-doctor/
- Supabase Auth on the web (Next.js / Vite / SvelteKit): https://arling.sk/supabase-redirect-doctor/
- Stripe webhook signature verification: https://arling.sk/stripe-webhook-doctor/
- Expo Universal Links / App Links: https://arling.sk/expo-universal-links-doctor/
- Supabase Auth on Flutter: https://arling.sk/flutter-supabase-doctor/
- SEPA pain.001 for Slovak banks: https://arling.sk/sepa-pain001-doctor/
