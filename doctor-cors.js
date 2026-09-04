// doctor-cors.js: CORS Doctor core logic.
//
// Pure, deterministic, 100% client-side: given the pasted "has been blocked
// by CORS policy" console error, the request your front end actually sent
// (page origin, request URL, method, credentials mode, custom headers,
// Content-Type), the CORS response headers your server sent back (or that
// you read off the Network tab), and which backend stack you're on, this
// works out exactly which CORS rule is broken, which side (browser request
// vs. server response) needs to change, and gives a copy-paste header value
// or server snippet.
//
// Nothing in this file makes a network request. It only reads the object you
// pass to diagnose() and, optionally, pattern-matches the text of a pasted
// browser console error.
//
// Same diagnose()-shape contract as the sibling "Doctor" tools (Google OAuth
// redirect_uri, Supabase/Expo/Flutter redirect allow-lists): one pure
// function, zero dependencies, single file.
//
// Rules implemented here are sourced from:
//  - https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
//      (what counts as a "simple request": methods GET/HEAD/POST and the
//      CORS-safelisted headers/content-types only, everything else needs a
//      preflight; "the * wildcard tells browsers to allow any origin... When
//      responding to a credentialed requests request, the server must
//      specify an origin... instead of specifying the * wildcard"; "if the
//      server specifies a single origin... rather than the * wildcard, then
//      the server should also include Origin in the Vary response header";
//      Access-Control-Allow-Credentials "indicates whether or not the
//      response... can be exposed when the credentials flag is true"; "the
//      server must not specify the * wildcard" for
//      Allow-Methods/Allow-Headers/Expose-Headers on a credentialed request;
//      redirects after a preflighted request: "some browsers... will report
//      an error... 'disallowed for cross-origin requests that require
//      preflight'"; "you won't be able to work around [a redirect] if the
//      request... triggers a preflight due to the presence of the
//      Authorization header")
//  - https://fetch.spec.whatwg.org/#http-cors-protocol
//      (the CORS check: Access-Control-Allow-Origin is compared byte-for-byte
//      against the request's origin, or must be exactly "*"; Access-
//      Control-Allow-Credentials must be exactly the byte sequence "true",
//      case-sensitive, with no other value accepted)
//  - https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS/Errors
//      (the catalogue of distinct browser CORS error reasons this tool's
//      message-parser recognizes: CORSMissingAllowOrigin,
//      CORSMultipleAllowOriginNotAllowed, CORSAllowOriginNotMatchingOrigin,
//      CORSNotSupportingCredentials, CORSMissingAllowCredentials,
//      CORSMethodNotFound, CORSInvalidAllowHeader/
//      CORSMissingAllowHeaderFromPreflight, CORSPreflightDidNotSucceed,
//      CORSExternalRedirectNotAllowed, CORSRequestNotHttp)
//  - https://expressjs.com/en/resources/middleware/cors.html
//      (Express `cors` middleware: origin/credentials/methods/allowedHeaders
//      options; `cors({ origin: 'https://example.com', credentials: true })`)
//  - https://fastapi.tiangolo.com/tutorial/cors/
//      (FastAPI CORSMiddleware: allow_origins/allow_credentials/
//      allow_methods/allow_headers; "you cannot use allow_origins=['*'] ...
//      allow_credentials=True: you have to use a specific origin")
//
// Works as an ES module (import { diagnose, expectedValues } from
// './doctor-cors.js') and, when loaded with <script type="module">, also
// publishes window.CorsDoctor = { diagnose, expectedValues } for
// console/debug use.

// ───────────────────────── small string helpers ─────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : '';
}

function trimTrailingSlash(s) {
  return safeStr(s).trim().replace(/\/+$/, '');
}

function stripWww(host) {
  return safeStr(host).replace(/^www\./i, '');
}

function isLoopbackHost(host) {
  const h = safeStr(host).toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h);
}

function splitList(raw) {
  return safeStr(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function listContainsCi(raw, needle) {
  const n = safeStr(needle).trim().toLowerCase();
  if (!n) return false;
  return splitList(raw).some((x) => x.toLowerCase() === n);
}

function varyHasOrigin(vary) {
  const raw = safeStr(vary).trim();
  if (!raw) return false;
  if (raw === '*') return true;
  return splitList(raw).some((x) => x.toLowerCase() === 'origin');
}

// ───────────────────────── origin parsing + diff ─────────────────────────
// CORS headers deal in *origins* (scheme + host + port), never a path, query
// or fragment: unlike the Google redirect_uri doctor, comparisons here stop
// at the authority component.

function parseOrigin(raw) {
  const s = safeStr(raw).trim();
  if (!s) return null;
  if (s === '*') return { raw: s, wildcard: true };
  if (/^null$/i.test(s)) return { raw: s, nullOrigin: true };
  try {
    const u = new URL(s);
    return {
      raw: s,
      scheme: u.protocol.replace(/:$/, '').toLowerCase(),
      host: u.hostname.toLowerCase(),
      port: u.port || '',
      origin: `${u.protocol}//${u.host}`,
      invalid: false,
    };
  } catch (e) {
    return { raw: s, invalid: true };
  }
}

/**
 * Compares two origins (scheme + host + port only). Returns [] when they are
 * effectively identical, otherwise a list of { type, detail } describing
 * every component that differs.
 */
function diffOrigins(rawA, rawB) {
  const a = parseOrigin(rawA);
  const b = parseOrigin(rawB);
  const diffs = [];
  if (!a || !b) return diffs;
  if (a.wildcard || b.wildcard || a.nullOrigin || b.nullOrigin) return diffs;
  if (a.raw === b.raw) return diffs;
  if (a.invalid || b.invalid) {
    diffs.push({ type: 'unparsable', detail: `"${a.raw}" and "${b.raw}" differ and at least one is not a well-formed origin.` });
    return diffs;
  }
  if (a.scheme !== b.scheme) {
    diffs.push({ type: 'scheme', detail: `scheme is "${a.scheme}" but should be "${b.scheme}"` });
  }
  if (a.host !== b.host) {
    if (stripWww(a.host) === stripWww(b.host)) {
      diffs.push({ type: 'www_apex', detail: `host is "${a.host}" but should be "${b.host}": a www vs. apex mismatch` });
    } else if (isLoopbackHost(a.host) && isLoopbackHost(b.host)) {
      diffs.push({ type: 'localhost_ip', detail: `host is "${a.host}" but should be "${b.host}": browsers treat localhost and 127.0.0.1 as different, unrelated origins even though both are loopback` });
    } else {
      diffs.push({ type: 'host', detail: `host is "${a.host}" but should be "${b.host}"` });
    }
  }
  if (a.port !== b.port) {
    diffs.push({ type: 'port', detail: `port is "${a.port || '(default)'}" but should be "${b.port || '(default)'}"` });
  }
  if (diffs.length === 0) {
    diffs.push({ type: 'other', detail: `"${a.raw}" and "${b.raw}" are not identical` });
  }
  return diffs;
}

function isLoopbackMismatch(diffs) {
  return diffs.length === 1 && diffs[0].type === 'localhost_ip';
}

// ───────────────────────── simple-request rules ─────────────────────────
// https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS: a request needs a
// preflight unless its method is GET/HEAD/POST, every header is on the
// CORS-safelisted set, and (for POST) its Content-Type is one of the three
// safelisted values.

const SIMPLE_METHODS = ['GET', 'HEAD', 'POST'];
const SIMPLE_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFELISTED_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type'];

function baseContentType(ct) {
  return safeStr(ct).split(';')[0].trim().toLowerCase();
}

function isSimpleContentType(ct) {
  const base = baseContentType(ct);
  if (!base) return true; // no request body/no Content-Type set never forces a preflight by itself
  return SIMPLE_CONTENT_TYPES.includes(base);
}

function computeNeedsPreflight(request) {
  const method = (safeStr(request.method).trim().toUpperCase() || 'GET');
  const reasons = [];
  if (!SIMPLE_METHODS.includes(method)) {
    reasons.push(`the method is "${method}", outside the simple-request set (GET, HEAD, POST)`);
  }
  const customHeaders = (Array.isArray(request.customHeaders) ? request.customHeaders : [])
    .map((h) => safeStr(h).trim())
    .filter(Boolean)
    .filter((h) => !SAFELISTED_HEADERS.includes(h.toLowerCase()));
  if (customHeaders.length) {
    reasons.push(`it sends header${customHeaders.length > 1 ? 's' : ''} ${customHeaders.map((h) => `"${h}"`).join(', ')}, outside the CORS-safelisted set`);
  }
  const ct = safeStr(request.contentType).trim();
  const nonSimpleContentType = ct && !isSimpleContentType(ct) ? ct : null;
  if (nonSimpleContentType) {
    reasons.push(`Content-Type is "${ct}", outside the simple set (application/x-www-form-urlencoded, multipart/form-data, text/plain)`);
  }
  return { needsPreflight: reasons.length > 0, reasons, method, customHeaders, nonSimpleContentType };
}

// ───────────────────────── server-side snippet builder ─────────────────────────

const STACKS = ['express', 'fastapi', 'django', 'rails', 'laravel', 'go', 'dotnet', 'supabase', 'firebase-functions', 'cloudflare-workers', 's3'];

const STACK_LABEL = {
  express: 'Express (cors middleware)',
  fastapi: 'FastAPI (CORSMiddleware)',
  django: 'Django (django-cors-headers)',
  rails: 'Rails (rack-cors)',
  laravel: 'Laravel',
  go: 'Go (net/http)',
  dotnet: '.NET / ASP.NET Core',
  supabase: 'Supabase Edge Function',
  'firebase-functions': 'Firebase Cloud Functions',
  'cloudflare-workers': 'Cloudflare Workers',
  s3: 'Amazon S3 bucket CORS',
};

function quotedList(raw, quote) {
  return splitList(raw)
    .map((s) => `${quote}${s}${quote}`)
    .join(', ');
}

function buildSnippet(stack, e) {
  const origin = e.acao || 'https://your-frontend.example';
  const methods = e.acam || 'GET, POST, OPTIONS';
  const headers = e.acah || 'Content-Type, Authorization';
  const withCreds = e.acac === 'true';

  switch (stack) {
    case 'express':
      return [
        `const cors = require('cors');`,
        ``,
        `app.use(cors({`,
        `  origin: '${origin}',`,
        `  credentials: ${withCreds},`,
        `  methods: '${methods}',`,
        `  allowedHeaders: '${headers}',`,
        `}));`,
        `// cors() must run before your routes and before any auth middleware`,
        `// that could otherwise 401/redirect the OPTIONS preflight itself.`,
      ].join('\n');
    case 'fastapi':
      return [
        `from fastapi.middleware.cors import CORSMiddleware`,
        ``,
        `app.add_middleware(`,
        `    CORSMiddleware,`,
        `    allow_origins=[${quotedList(origin, '"')}],`,
        `    allow_credentials=${withCreds ? 'True' : 'False'},`,
        `    allow_methods=[${quotedList(methods, '"')}],`,
        `    allow_headers=[${quotedList(headers, '"')}],`,
        `)`,
        `# allow_origins can't be ["*"] together with allow_credentials=True.`,
      ].join('\n');
    case 'django':
      return [
        `# settings.py`,
        `INSTALLED_APPS = [`,
        `    ...,`,
        `    "corsheaders",`,
        `]`,
        `MIDDLEWARE = [`,
        `    "corsheaders.middleware.CorsMiddleware",  # as high as possible`,
        `    "django.middleware.common.CommonMiddleware",`,
        `    ...,`,
        `]`,
        `CORS_ALLOWED_ORIGINS = [${quotedList(origin, '"')}]`,
        `CORS_ALLOW_CREDENTIALS = ${withCreds ? 'True' : 'False'}`,
      ].join('\n');
    case 'rails':
      return [
        `# config/initializers/cors.rb`,
        `Rails.application.config.middleware.insert_before 0, Rack::Cors do`,
        `  allow do`,
        `    origins '${origin}'`,
        `    resource '*',`,
        `      headers: :any,`,
        `      methods: [:get, :post, :put, :patch, :delete, :options],`,
        `      credentials: ${withCreds}`,
        `  end`,
        `end`,
      ].join('\n');
    case 'laravel':
      return [
        `// config/cors.php`,
        `return [`,
        `    'paths' => ['api/*'],`,
        `    'allowed_methods' => ['*'],`,
        `    'allowed_origins' => [${quotedList(origin, "'")}],`,
        `    'allowed_headers' => ['*'],`,
        `    'supports_credentials' => ${withCreds ? 'true' : 'false'},`,
        `];`,
      ].join('\n');
    case 'go':
      return [
        `w.Header().Set("Access-Control-Allow-Origin", "${origin}")`,
        `w.Header().Set("Vary", "Origin")`,
        withCreds ? `w.Header().Set("Access-Control-Allow-Credentials", "true")` : null,
        `if r.Method == http.MethodOptions {`,
        `  w.Header().Set("Access-Control-Allow-Methods", "${methods}")`,
        `  w.Header().Set("Access-Control-Allow-Headers", "${headers}")`,
        `  w.WriteHeader(http.StatusNoContent)`,
        `  return`,
        `}`,
      ].filter((x) => x !== null).join('\n');
    case 'dotnet':
      return [
        `builder.Services.AddCors(o => o.AddPolicy("app", p => p`,
        `    .WithOrigins("${origin}")`,
        `    .WithMethods(${quotedList(methods, '"')})`,
        `    .WithHeaders(${quotedList(headers, '"')})${withCreds ? '' : ''}${withCreds ? '\n    .AllowCredentials()' : ''}));`,
        ``,
        `app.UseCors("app"); // before app.UseAuthorization()`,
      ].join('\n');
    case 'supabase':
      return [
        `// Supabase Edge Function (Deno)`,
        `const corsHeaders = {`,
        `  "Access-Control-Allow-Origin": "${origin}",`,
        `  "Access-Control-Allow-Headers": "${headers}",`,
        `};`,
        ``,
        `Deno.serve(async (req) => {`,
        `  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });`,
        `  // ...`,
        `  return new Response(JSON.stringify({ ok: true }), {`,
        `    headers: { ...corsHeaders, "Content-Type": "application/json" },`,
        `  });`,
        `});`,
      ].join('\n');
    case 'firebase-functions':
      return [
        `const cors = require('cors')({ origin: '${origin}', credentials: ${withCreds} });`,
        ``,
        `exports.myFunction = functions.https.onRequest((req, res) => {`,
        `  cors(req, res, () => {`,
        `    // the cors() wrapper already answers the OPTIONS preflight`,
        `    res.json({ ok: true });`,
        `  });`,
        `});`,
      ].join('\n');
    case 'cloudflare-workers':
      return [
        `export default {`,
        `  async fetch(request) {`,
        `    const headers = new Headers({`,
        `      "Access-Control-Allow-Origin": "${origin}",`,
        `      "Vary": "Origin",`,
        withCreds ? `      "Access-Control-Allow-Credentials": "true",` : null,
        `    });`,
        `    if (request.method === "OPTIONS") {`,
        `      headers.set("Access-Control-Allow-Methods", "${methods}");`,
        `      headers.set("Access-Control-Allow-Headers", "${headers}");`,
        `      return new Response(null, { headers });`,
        `    }`,
        `    return new Response(JSON.stringify({ ok: true }), {`,
        `      headers: { ...Object.fromEntries(headers), "Content-Type": "application/json" },`,
        `    });`,
        `  },`,
        `};`,
      ].filter((x) => x !== null).join('\n');
    case 's3':
      return [
        `[`,
        `  {`,
        `    "AllowedOrigins": [${quotedList(origin, '"')}],`,
        `    "AllowedMethods": [${quotedList(methods, '"')}],`,
        `    "AllowedHeaders": [${quotedList(headers, '"')}]`,
        `  }`,
        `]`,
        `// Bucket -> Permissions -> Cross-origin resource sharing (CORS).`,
        `// S3 has no cookie/credentials concept: this is for anonymous or`,
        `// pre-signed-URL requests only.`,
      ].join('\n');
    default:
      return [
        `Access-Control-Allow-Origin: ${origin}`,
        withCreds ? `Access-Control-Allow-Credentials: true` : null,
        `Vary: Origin`,
        `# On OPTIONS, if a preflight is needed:`,
        `Access-Control-Allow-Methods: ${methods}`,
        `Access-Control-Allow-Headers: ${headers}`,
      ].filter((x) => x !== null).join('\n');
  }
}

// ───────────────────────── expected-value builder ─────────────────────────

function computeExpected(cfg) {
  const request = cfg.request && typeof cfg.request === 'object' ? cfg.request : {};
  const server = cfg.server && typeof cfg.server === 'object' ? cfg.server : {};
  const stack = STACKS.includes(server.stack) ? server.stack : '';
  const pf = computeNeedsPreflight(request);
  const pageOrigin = trimTrailingSlash(request.pageOrigin);
  const credentials = ['omit', 'same-origin', 'include'].includes(request.credentials) ? request.credentials : '';

  const headersForAllowlist = pf.customHeaders.slice();
  if (pf.nonSimpleContentType) headersForAllowlist.push('Content-Type');

  const expected = {
    stack,
    stackLabel: stack ? STACK_LABEL[stack] : null,
    credentials,
    needsPreflight: pf.needsPreflight,
    preflightReasons: pf.reasons,
    method: pf.method,
    acao: pageOrigin || null,
    acac: credentials === 'include' ? 'true' : null,
    acam: pf.needsPreflight ? Array.from(new Set([pf.method, 'OPTIONS'])).join(', ') : null,
    acah: headersForAllowlist.length ? headersForAllowlist.join(', ') : null,
    vary: 'Origin',
  };
  expected.snippet = buildSnippet(stack, expected);
  return expected;
}

// ───────────────────────── pasted console-error classifier ─────────────────────────
// Recognizes the literal phrasing Chrome/Edge and Firefox print for each
// distinct CORS failure reason (see the MDN CORS/Errors catalogue cited in
// the file header), so a diagnosis is still possible from nothing but a
// pasted error message.

const MESSAGE_RULES = [
  {
    code: 'missing_acao',
    re: /no 'access-control-allow-origin' header is present|header 'access-control-allow-origin' missing/i,
    message: "The pasted error says no Access-Control-Allow-Origin header is present on the response. The server (or a proxy/CDN/load balancer in front of it) never sent the header at all: this is not a case of the value being wrong.",
    fix: 'Add Access-Control-Allow-Origin to the actual response the browser receives, including error responses from that same route.',
  },
  {
    code: 'multiple_acao_values',
    re: /access-control-allow-origin' header contains multiple values|multiple cors header 'access-control-allow-origin' not allowed/i,
    message: "The pasted error says Access-Control-Allow-Origin had multiple values in one header. This usually means server code appended an origin to an existing header instead of choosing exactly one value to send back.",
    fix: 'Send exactly one Access-Control-Allow-Origin value per response: either the single matching origin, or *, never a comma-joined list.',
  },
  {
    code: 'acao_origin_mismatch',
    re: /access-control-allow-origin' header has a value '([^']*)' that is not equal to the supplied origin|access-control-allow-origin' does not match/i,
    build: (m) => ({
      message: m && m[1]
        ? `The pasted error says Access-Control-Allow-Origin was "${m[1]}", which does not equal the page's own origin. The header must match byte-for-byte: scheme, host, and port all count.`
        : "The pasted error says Access-Control-Allow-Origin does not match the page's origin byte-for-byte.",
      fix: 'Make the server send back exactly the requesting origin (or switch to a real allow-list that reflects it), not a hardcoded different value.',
    }),
  },
  {
    code: 'acao_wildcard_with_credentials',
    re: /credential is not supported if the cors header 'access-control-allow-origin' is '\*'|must not be the wildcard '\*' when the request's credentials mode is 'include'/i,
    message: "The pasted error says credentials aren't supported with Access-Control-Allow-Origin: *. Per the spec, a credentialed request (cookies, or fetch with credentials: 'include') can never be paired with the * wildcard.",
    fix: 'Send the exact requesting origin instead of *, plus Access-Control-Allow-Credentials: true and Vary: Origin.',
  },
  {
    code: 'missing_acac',
    re: /access-control-allow-credentials' header .* must be 'true'|expected 'true' in cors header 'access-control-allow-credentials'/i,
    message: 'The pasted error says Access-Control-Allow-Credentials must be "true". The request was sent with credentials, but the response either omitted this header or sent something other than the exact string "true".',
    fix: 'Add Access-Control-Allow-Credentials: true to the response (the value must be the literal string "true", case-sensitive).',
  },
  {
    code: 'method_not_in_acam',
    re: /method '?([a-z]+)'? is not allowed by access-control-allow-methods|did not find method in cors header 'access-control-allow-methods'/i,
    build: (m) => ({
      message: m && m[1]
        ? `The pasted error says method "${m[1]}" is not allowed by Access-Control-Allow-Methods on the preflight response.`
        : 'The pasted error says the request method was not found in Access-Control-Allow-Methods on the preflight response.',
      fix: 'Include the actual request method in Access-Control-Allow-Methods on the OPTIONS response.',
    }),
  },
  {
    code: 'header_not_in_acah',
    re: /request header field '?([\w-]+)'? is not allowed by access-control-allow-headers|missing token '([\w-]+)' in cors header 'access-control-allow-headers'/i,
    build: (m) => {
      const h = (m && (m[1] || m[2])) || null;
      return {
        message: h
          ? `The pasted error says header "${h}" is not allowed by Access-Control-Allow-Headers on the preflight response.`
          : 'The pasted error says a request header is not allowed by Access-Control-Allow-Headers on the preflight response.',
        fix: h ? `Add "${h}" to Access-Control-Allow-Headers on the OPTIONS response.` : 'Add the missing header name to Access-Control-Allow-Headers on the OPTIONS response.',
      };
    },
  },
  {
    code: 'preflight_redirect',
    re: /redirect is not allowed for a preflight request|cors request external redirect not allowed/i,
    message: 'The pasted error says a redirect happened during a preflighted request. Browsers refuse to follow a redirect for the OPTIONS preflight, especially to a different origin.',
    fix: 'Point the request straight at the final URL (no redirect), or make the request simple enough to skip preflight so any redirect on the actual request can be followed instead.',
  },
  {
    code: 'not_http',
    re: /cors request not http/i,
    message: 'The pasted error says the CORS request was not HTTP. This happens when the request URL uses a non-http(s) scheme (file://, a bundled app scheme, etc.), which CORS was never designed to cover.',
    fix: 'Serve and call the API over http:// or https://, not a file:// or custom-scheme page.',
  },
  {
    code: 'preflight_status_not_ok',
    re: /cors preflight channel did not succeed|it does not have http ok status|response to preflight request doesn't pass access control check/i,
    message: 'The pasted error says the preflight (OPTIONS) request itself failed or did not return a successful status. Something before your CORS logic (auth middleware, a 404 router, a WAF) is intercepting OPTIONS.',
    fix: 'Make sure OPTIONS requests reach your CORS handler first and get a 2xx response, before any auth check or catch-all 404.',
  },
];

function classifyMessage(msg) {
  const s = safeStr(msg);
  if (!s) return [];
  const out = [];
  for (const rule of MESSAGE_RULES) {
    const m = s.match(rule.re);
    if (!m) continue;
    const built = typeof rule.build === 'function' ? rule.build(m) : { message: rule.message, fix: rule.fix };
    out.push({ code: rule.code, message: built.message, fix: built.fix });
  }
  return out;
}

// ───────────────────────── diagnose() ─────────────────────────

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortProblems(problems) {
  return problems
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => (SEVERITY_ORDER[a.p.severity] - SEVERITY_ORDER[b.p.severity]) || (a.idx - b.idx))
    .map((x) => x.p);
}

function pushProblem(problems, { severity, code, message, path, value, fix }) {
  problems.push({ severity, code, message, path: path || null, value: value == null ? null : value, fix: fix || null, where: path || null });
}

const MESSAGE_SEVERITY = {
  missing_acao: 'high',
  multiple_acao_values: 'high',
  acao_origin_mismatch: 'high',
  acao_wildcard_with_credentials: 'high',
  missing_acac: 'high',
  method_not_in_acam: 'high',
  header_not_in_acah: 'high',
  preflight_redirect: 'high',
  not_http: 'medium',
  preflight_status_not_ok: 'medium',
};

/**
 * @param {object} config
 * @param {{message?:string}} [config.error] - the pasted browser console error text
 * @param {{pageOrigin?:string, requestUrl?:string, method?:string, credentials?:'omit'|'same-origin'|'include'|'', customHeaders?:string[], contentType?:string}} [config.request]
 * @param {{acao?:string, acac?:''|'true', acam?:string, acah?:string, vary?:string, status?:number|null, redirectsToOtherOrigin?:boolean|null, preflightStatus?:number|null}} [config.response]
 * @param {{stack?:string}} [config.server]
 * @returns {{status:'pass'|'warn'|'fail', summary:string, expected:object, problems:Array, fixes:Array, checklist:string[], disclaimer:string}}
 */
export function diagnose(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const errorCfg = cfg.error && typeof cfg.error === 'object' ? cfg.error : {};
  const request = cfg.request && typeof cfg.request === 'object' ? cfg.request : {};
  const response = cfg.response && typeof cfg.response === 'object' ? cfg.response : {};

  const problems = [];
  const fixes = [];
  const checklist = [];

  const errorMessage = safeStr(errorCfg.message).trim();
  const pageOrigin = trimTrailingSlash(request.pageOrigin);
  const requestUrl = safeStr(request.requestUrl).trim();
  const credentials = ['omit', 'same-origin', 'include'].includes(request.credentials) ? request.credentials : '';

  const acao = safeStr(response.acao).trim();
  const acac = response.acac === 'true' ? 'true' : '';
  const acam = safeStr(response.acam).trim();
  const acah = safeStr(response.acah).trim();
  const vary = safeStr(response.vary).trim();
  const status = typeof response.status === 'number' && isFinite(response.status) ? response.status : null;
  const preflightStatus = typeof response.preflightStatus === 'number' && isFinite(response.preflightStatus) ? response.preflightStatus : null;
  const redirectsToOtherOrigin = response.redirectsToOtherOrigin === true ? true : response.redirectsToOtherOrigin === false ? false : null;

  const expected = computeExpected(cfg);
  const pf = { needsPreflight: expected.needsPreflight, reasons: expected.preflightReasons, method: expected.method, customHeaders: (Array.isArray(request.customHeaders) ? request.customHeaders : []).map((h) => safeStr(h).trim()).filter(Boolean).filter((h) => !SAFELISTED_HEADERS.includes(h.toLowerCase())), nonSimpleContentType: request.contentType && !isSimpleContentType(request.contentType) ? request.contentType : null };
  const headersForAllowlist = pf.customHeaders.slice();
  if (pf.nonSimpleContentType) headersForAllowlist.push('Content-Type');

  let loopbackFlagged = false;

  if (!pageOrigin && !requestUrl && !errorMessage) {
    pushProblem(problems, {
      severity: 'medium',
      code: 'no_input',
      message: 'Fill in at least the page origin and the request URL, or paste the console error, to get a diagnosis.',
      path: 'request.pageOrigin',
    });
  } else {
    // ── 1. structural: comma-joined ACAO (server sent more than one origin) ──
    if (acao.includes(',')) {
      pushProblem(problems, {
        severity: 'high',
        code: 'multiple_acao_values',
        message: `Access-Control-Allow-Origin is "${acao}": more than one value in a single header. Browsers accept exactly one origin (or *) here, never a list.`,
        path: 'response.acao',
        value: acao,
        fix: 'Send exactly one Access-Control-Allow-Origin value: pick the single origin that matches the request (or *, if credentials are never used).',
      });
    }

    // ── 2. missing ACAO ──────────────────────────────────────────────────
    if (!acao) {
      pushProblem(problems, {
        severity: 'high',
        code: 'missing_acao',
        message: "No Access-Control-Allow-Origin header is present on the response. This is the single most common CORS failure: the browser blocks the response client-side even when the server returned real data, because the response carries no permission for this origin to read it.",
        path: 'response.acao',
        fix: `Add Access-Control-Allow-Origin: ${pageOrigin || '<your frontend origin>'} to the response.`,
      });
      fixes.push({ title: 'Add Access-Control-Allow-Origin to the response', value: `Access-Control-Allow-Origin: ${expected.acao || 'https://your-frontend.example'}`, where: 'Your server (see the snippet below for your stack)' });
    } else {
      // ── 3. ACAO value checks (wildcard / null / mismatch) ────────────────
      if (acao === '*') {
        if (credentials === 'include') {
          pushProblem(problems, {
            severity: 'high',
            code: 'acao_wildcard_with_credentials',
            message: "Access-Control-Allow-Origin is \"*\" but the request is sent with credentials (cookies or fetch credentials: 'include'). The spec forbids pairing a credentialed request with the wildcard: the server must specify an origin, instead of specifying the * wildcard.",
            path: 'response.acao',
            value: acao,
            fix: pageOrigin ? `Access-Control-Allow-Origin: ${pageOrigin}` : 'Send the exact requesting origin instead of *.',
          });
          fixes.push({ title: 'Replace * with the exact origin, and set Allow-Credentials', value: `Access-Control-Allow-Origin: ${pageOrigin || '<your frontend origin>'}\nAccess-Control-Allow-Credentials: true\nVary: Origin`, where: 'Your server' });
        }
      } else if (/^null$/i.test(acao)) {
        pushProblem(problems, {
          severity: 'high',
          code: 'acao_null_origin',
          message: 'Access-Control-Allow-Origin is the literal string "null". That only ever matches a request whose own Origin header is "null" (a sandboxed iframe, a file:// page, or certain redirect chains); it will not match a normal https:// page origin.',
          path: 'response.acao',
          value: acao,
          fix: pageOrigin ? `Access-Control-Allow-Origin: ${pageOrigin}` : 'Send the real page origin, not the literal string "null".',
        });
      } else {
        const diffs = diffOrigins(acao, pageOrigin || acao);
        if (pageOrigin && diffs.length) {
          if (isLoopbackMismatch(diffs)) {
            pushProblem(problems, {
              severity: 'medium',
              code: 'localhost_vs_loopback_ip',
              message: `Access-Control-Allow-Origin is "${acao}" but the page origin is "${pageOrigin}": ${diffs[0].detail}.`,
              path: 'response.acao',
              value: acao,
              fix: `Access-Control-Allow-Origin: ${pageOrigin}`,
            });
            loopbackFlagged = true;
          } else {
            const detailList = diffs.map((d) => d.detail).join('; ');
            pushProblem(problems, {
              severity: 'high',
              code: 'acao_origin_mismatch',
              message: `Access-Control-Allow-Origin is "${acao}" but the page's origin is "${pageOrigin}": ${detailList}. The comparison is byte-for-byte on scheme, host and port; nothing here is normalized.`,
              path: 'response.acao',
              value: acao,
              fix: `Access-Control-Allow-Origin: ${pageOrigin}`,
            });
          }
          fixes.push({ title: 'Send back the exact requesting origin', value: `Access-Control-Allow-Origin: ${pageOrigin}`, where: 'Your server' });
        } else {
          // ACAO matches the page origin (or nothing to compare against): credentials + Vary checks apply.
          if (credentials === 'include' && acac !== 'true') {
            pushProblem(problems, {
              severity: 'high',
              code: 'missing_acac',
              message: "The request is sent with credentials, Access-Control-Allow-Origin matches the page origin, but Access-Control-Allow-Credentials is missing or not exactly \"true\". Simple GET requests aren't preflighted, so if this header isn't on the actual response, the browser silently discards the response instead of handing it to your code.",
              path: 'response.acac',
              value: acac || null,
              fix: 'Access-Control-Allow-Credentials: true',
            });
            fixes.push({ title: 'Add Access-Control-Allow-Credentials: true', value: 'Access-Control-Allow-Credentials: true', where: 'Your server' });
          }
          if (!varyHasOrigin(vary)) {
            pushProblem(problems, {
              severity: 'low',
              code: 'vary_origin_missing',
              message: `Access-Control-Allow-Origin is a specific origin (not *), which usually means the server reflects or allow-lists the caller's Origin. Vary: Origin is missing, so shared/CDN caches can serve one origin's cached response to a different origin.`,
              path: 'response.vary',
              fix: 'Add Origin to the Vary response header (append it if Vary already lists other headers).',
            });
          }
        }
      }
    }

    // ── 4. preflight ─────────────────────────────────────────────────────
    if (pf.needsPreflight) {
      if (preflightStatus == null) {
        pushProblem(problems, {
          severity: 'low',
          code: 'preflight_status_unknown',
          message: `This request needs a preflight (${pf.reasons.join('; ')}). Open DevTools → Network and check the OPTIONS request that should appear right before it: its status and headers aren't filled in here yet.`,
          path: 'response.preflightStatus',
        });
      } else if (preflightStatus < 200 || preflightStatus >= 300) {
        pushProblem(problems, {
          severity: 'high',
          code: 'preflight_status_not_ok',
          message: `The OPTIONS preflight returned ${preflightStatus}, not a 2xx. A browser only proceeds with the real request after a successful preflight; a common cause is auth middleware or a catch-all router running before your CORS handler and rejecting OPTIONS with a 401/404.`,
          path: 'response.preflightStatus',
          value: preflightStatus,
          fix: 'Make CORS middleware run first, so OPTIONS requests short-circuit with a 2xx before any auth check or router miss.',
        });
      } else {
        if (!acam) {
          pushProblem(problems, {
            severity: 'high',
            code: 'preflight_missing_acam',
            message: 'The preflight succeeded, but the response has no Access-Control-Allow-Methods header, so the browser has nothing to check the actual method against and blocks the real request.',
            path: 'response.acam',
            fix: `Access-Control-Allow-Methods: ${expected.acam || pf.method}`,
          });
          fixes.push({ title: 'Add Access-Control-Allow-Methods to the OPTIONS response', value: `Access-Control-Allow-Methods: ${expected.acam || pf.method}`, where: 'Your server' });
        } else if (acam.trim() === '*') {
          if (credentials === 'include') {
            pushProblem(problems, {
              severity: 'high',
              code: 'acam_wildcard_with_credentials',
              message: 'Access-Control-Allow-Methods is "*" on a credentialed request. The server must not specify the * wildcard here for a credentialed request: it must list methods explicitly.',
              path: 'response.acam',
              value: acam,
              fix: `Access-Control-Allow-Methods: ${expected.acam || pf.method}`,
            });
          }
        } else if (!listContainsCi(acam, pf.method)) {
          pushProblem(problems, {
            severity: 'high',
            code: 'method_not_in_acam',
            message: `The actual request uses "${pf.method}", but Access-Control-Allow-Methods on the preflight response is "${acam}", which doesn't include it.`,
            path: 'response.acam',
            value: acam,
            fix: `Add "${pf.method}" to Access-Control-Allow-Methods.`,
          });
        }

        if (headersForAllowlist.length) {
          if (!acah) {
            pushProblem(problems, {
              severity: 'high',
              code: 'preflight_missing_acah',
              message: `The request sends header${headersForAllowlist.length > 1 ? 's' : ''} ${headersForAllowlist.map((h) => `"${h}"`).join(', ')}, but the preflight response has no Access-Control-Allow-Headers at all.`,
              path: 'response.acah',
              fix: `Access-Control-Allow-Headers: ${headersForAllowlist.join(', ')}`,
            });
            fixes.push({ title: 'Add Access-Control-Allow-Headers to the OPTIONS response', value: `Access-Control-Allow-Headers: ${headersForAllowlist.join(', ')}`, where: 'Your server' });
          } else if (acah.trim() === '*' && credentials === 'include') {
            pushProblem(problems, {
              severity: 'high',
              code: 'acah_wildcard_with_credentials',
              message: 'Access-Control-Allow-Headers is "*" on a credentialed request. Like Allow-Methods, the wildcard is not honored here for a credentialed request: headers must be listed explicitly.',
              path: 'response.acah',
              value: acah,
              fix: `Access-Control-Allow-Headers: ${headersForAllowlist.join(', ')}`,
            });
          } else if (acah.trim() !== '*') {
            const missing = headersForAllowlist.filter((h) => !listContainsCi(acah, h));
            if (missing.length) {
              pushProblem(problems, {
                severity: 'high',
                code: 'header_not_in_acah',
                message: `Header${missing.length > 1 ? 's' : ''} ${missing.map((h) => `"${h}"`).join(', ')} the request sends ${missing.length > 1 ? 'are' : 'is'} not in Access-Control-Allow-Headers ("${acah}").`,
                path: 'response.acah',
                value: acah,
                fix: `Add ${missing.map((h) => `"${h}"`).join(', ')} to Access-Control-Allow-Headers.`,
              });
            }
          }
        }
      }
    }

    // ── 5. redirect during preflight ────────────────────────────────────
    if (pf.needsPreflight && redirectsToOtherOrigin === true) {
      pushProblem(problems, {
        severity: 'high',
        code: 'preflight_redirect',
        message: "The request redirects to a different origin, and this request needs a preflight. Browsers refuse to follow a redirect for a preflighted request: some report it explicitly as \"disallowed for cross-origin requests that require preflight\". If the redirect is only reachable because of an Authorization header, there is no client-side workaround at all.",
        path: 'response.redirectsToOtherOrigin',
        fix: 'Point the request straight at the final URL, or serve it from the same origin so no redirect is involved.',
      });
    }

    // ── 6. error status with no CORS headers ────────────────────────────
    if (status != null && status >= 400 && !acao) {
      pushProblem(problems, {
        severity: 'medium',
        code: 'error_status_no_cors_headers',
        message: `The actual response status is ${status}. A lot of frameworks only attach CORS headers on the success path (a router 404, an auth 401, or an unhandled 500 skip the CORS middleware entirely), so the browser's CORS error may just be surfacing a real ${status} underneath, not a separate misconfiguration.`,
        path: 'response.status',
        value: status,
        fix: 'Check the response body/status for the real error first; make sure CORS headers are attached to error responses too, not only 2xx ones.',
      });
    }

    // ── 7. localhost vs. 127.0.0.1 between page and request URL ────────
    if (!loopbackFlagged && pageOrigin && requestUrl) {
      const rDiffs = diffOrigins(requestUrl, pageOrigin);
      if (isLoopbackMismatch(rDiffs)) {
        pushProblem(problems, {
          severity: 'medium',
          code: 'localhost_vs_loopback_ip',
          message: `The page runs on "${pageOrigin}" and the request goes to "${requestUrl}": ${rDiffs[0].detail}. If the server's allow-list has the other one registered, this alone causes a CORS block.`,
          path: 'request.requestUrl',
          fix: 'Use the same loopback host consistently on both sides, or allow-list both localhost and 127.0.0.1 on the server.',
        });
      }
    }

    // ── 8. cross-site cookies need SameSite=None; Secure ────────────────
    if (credentials === 'include' && pageOrigin && requestUrl) {
      const p = parseOrigin(pageOrigin);
      const r = parseOrigin(requestUrl);
      if (p && r && !p.invalid && !r.invalid && p.host !== r.host) {
        pushProblem(problems, {
          severity: 'medium',
          code: 'samesite_none_secure_needed',
          message: 'Credentials are included and the API is on a different host than the page: this is a cross-site request. Any cookie the server wants the browser to keep sending here needs Set-Cookie: ...; SameSite=None; Secure, or the browser drops it regardless of what the CORS headers say.',
          path: 'request.credentials',
          fix: 'Add SameSite=None; Secure to the cookie, and confirm the browser is not blocking third-party cookies outright (Safari ITP, Chrome\'s phase-out): if it is, cookies aren\'t a viable transport and a bearer token in a header is the safer fallback.',
        });
      }
    }
  }

  // ── message-derived problems: fill in anything the structured fields above didn't already cover ──
  if (errorMessage) {
    const classified = classifyMessage(errorMessage);
    for (const item of classified) {
      if (problems.some((p) => p.code === item.code)) continue;
      pushProblem(problems, {
        severity: MESSAGE_SEVERITY[item.code] || 'medium',
        code: item.code,
        message: item.message,
        path: 'error.message',
        fix: item.fix,
      });
    }
  }

  checklist.push('Open DevTools → Network, click the failed request, and check both it and (if the method/headers force one) the OPTIONS preflight just above it: the Console tab only shows a one-line summary, not which header is missing.');
  checklist.push('Compare Access-Control-Allow-Origin byte-for-byte against the page origin: scheme, host (www vs. apex, localhost vs. 127.0.0.1) and port all count, and there is no path component to an origin.');
  if (expected.needsPreflight) {
    checklist.push(`This request needs a preflight because ${expected.preflightReasons.join('; ')}.`);
  }
  checklist.push('CORS headers are response headers your server controls. Setting an "Access-Control-Allow-Origin" request header on the frontend does nothing: if that is what changed, it is fixing the wrong side.');
  checklist.push('Re-check after every deploy: a reverse proxy, CDN or load balancer in front of your API can strip or rewrite CORS headers even when your application code is correct.');

  const sorted = sortProblems(problems);
  const highCount = sorted.filter((p) => p.severity === 'high').length;
  const medCount = sorted.filter((p) => p.severity === 'medium').length;
  const lowCount = sorted.filter((p) => p.severity === 'low').length;

  let status2;
  if (highCount > 0) status2 = 'fail';
  else if (medCount > 0 || lowCount > 0) status2 = 'warn';
  else status2 = 'pass';

  let summary;
  if (status2 === 'pass') {
    summary = 'No CORS mismatches found in what you entered: the response headers look consistent with the request as described.';
  } else if (status2 === 'fail') {
    const top = sorted.find((p) => p.severity === 'high');
    summary = `${highCount} blocking mismatch${highCount > 1 ? 'es' : ''} found. Most urgent: ${top.message}`;
  } else {
    const top = sorted[0];
    summary = `Nothing blocking, but ${medCount + lowCount} thing${medCount + lowCount > 1 ? 's' : ''} worth checking. Top of the list: ${top.message}`;
  }

  return {
    status: status2,
    summary,
    expected,
    problems: sorted,
    fixes,
    checklist,
    disclaimer:
      'Read-only, client-side analysis of the values you entered. Nothing is verified against your live server: always confirm with your browser\'s Network tab and your server logs before shipping a fix.',
  };
}

/**
 * Standalone helper: just the expected/recommended values for a config,
 * without running the full diagnostic. Handy for live-updating a preview
 * (or the server snippet) as the user types.
 */
export function expectedValues(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  return computeExpected(cfg);
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.CorsDoctor = { diagnose, expectedValues };
}
