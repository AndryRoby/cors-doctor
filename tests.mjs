// tests.mjs — plain Node test runner for doctor-cors.js (no external dependencies).
// Run with: node tests.mjs

import { diagnose, expectedValues } from './doctor-cors.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(name, actual, expected) {
  const condition = actual === expected;
  ok(name, condition, condition ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function has(name, arr, code) {
  const condition = Array.isArray(arr) && arr.some((p) => p.code === code);
  ok(name, condition, condition ? '' : `expected a problem with code "${code}", got codes [${(arr || []).map((p) => p.code).join(', ')}]`);
}

function lacks(name, arr, code) {
  const condition = Array.isArray(arr) && !arr.some((p) => p.code === code);
  ok(name, condition, condition ? '' : `did not expect a problem with code "${code}"`);
}

function severityOf(arr, code) {
  const p = (arr || []).find((x) => x.code === code);
  return p ? p.severity : undefined;
}

function messageOf(arr, code) {
  const p = (arr || []).find((x) => x.code === code);
  return p ? p.message : '';
}

// ─────────────────────────────────────────────────────────────────────────
// 1. expectedValues() — preflight detection and recommended header values
// ─────────────────────────────────────────────────────────────────────────

eq('GET, no custom headers, no content-type: no preflight needed',
  expectedValues({ request: { method: 'GET', pageOrigin: 'https://myapp.com' } }).needsPreflight, false);

eq('POST with application/json content-type: preflight needed',
  expectedValues({ request: { method: 'POST', contentType: 'application/json' } }).needsPreflight, true);

eq('POST with application/x-www-form-urlencoded: no preflight (simple content-type)',
  expectedValues({ request: { method: 'POST', contentType: 'application/x-www-form-urlencoded' } }).needsPreflight, false);

eq('POST with text/plain; charset=UTF-8: no preflight (parameters ignored)',
  expectedValues({ request: { method: 'POST', contentType: 'text/plain; charset=UTF-8' } }).needsPreflight, false);

eq('PUT method: preflight needed',
  expectedValues({ request: { method: 'PUT' } }).needsPreflight, true);

eq('GET with custom header Authorization: preflight needed',
  expectedValues({ request: { method: 'GET', customHeaders: ['Authorization'] } }).needsPreflight, true);

eq('GET with only safelisted header Accept: no preflight',
  expectedValues({ request: { method: 'GET', customHeaders: ['Accept'] } }).needsPreflight, false);

eq('expected.acao mirrors pageOrigin (trailing slash stripped)',
  expectedValues({ request: { pageOrigin: 'https://myapp.com/' } }).acao, 'https://myapp.com');

eq('expected.acac is "true" when credentials is include',
  expectedValues({ request: { credentials: 'include' } }).acac, 'true');

eq('expected.acac is null when credentials is omit',
  expectedValues({ request: { credentials: 'omit' } }).acac, null);

{
  const e = expectedValues({ request: { method: 'PUT' } });
  ok('expected.acam includes both the method and OPTIONS', e.acam.includes('PUT') && e.acam.includes('OPTIONS'));
}

{
  const e = expectedValues({ request: { method: 'POST', customHeaders: ['Authorization'], contentType: 'application/json' } });
  ok('expected.acah includes the custom header', e.acah.includes('Authorization'));
  ok('expected.acah includes Content-Type for a non-simple body', e.acah.includes('Content-Type'));
}

eq('expected.acam is null when no preflight is needed',
  expectedValues({ request: { method: 'GET' } }).acam, null);

// ─────────────────────────────────────────────────────────────────────────
// 2. expectedValues() — per-stack snippet builder
// ─────────────────────────────────────────────────────────────────────────

ok('express snippet mentions the cors package', expectedValues({ server: { stack: 'express' } }).snippet.includes("require('cors')"));
ok('fastapi snippet mentions CORSMiddleware', expectedValues({ server: { stack: 'fastapi' } }).snippet.includes('CORSMiddleware'));
ok('django snippet mentions corsheaders', expectedValues({ server: { stack: 'django' } }).snippet.includes('corsheaders'));
ok('rails snippet mentions Rack::Cors', expectedValues({ server: { stack: 'rails' } }).snippet.includes('Rack::Cors'));
ok('laravel snippet mentions supports_credentials', expectedValues({ server: { stack: 'laravel' } }).snippet.includes('supports_credentials'));
ok('go snippet mentions w.Header().Set', expectedValues({ server: { stack: 'go' } }).snippet.includes('w.Header().Set'));
ok('dotnet snippet mentions AddCors', expectedValues({ server: { stack: 'dotnet' } }).snippet.includes('AddCors'));
ok('supabase snippet mentions Deno.serve', expectedValues({ server: { stack: 'supabase' } }).snippet.includes('Deno.serve'));
ok('firebase-functions snippet mentions functions.https.onRequest', expectedValues({ server: { stack: 'firebase-functions' } }).snippet.includes('functions.https.onRequest'));
ok('cloudflare-workers snippet mentions export default', expectedValues({ server: { stack: 'cloudflare-workers' } }).snippet.includes('export default'));
ok('s3 snippet mentions AllowedOrigins', expectedValues({ server: { stack: 's3' } }).snippet.includes('AllowedOrigins'));
ok('unset/unknown stack falls back to a generic header snippet', expectedValues({ server: { stack: 'nope' } }).snippet.includes('Access-Control-Allow-Origin:'));
eq('unset stack has no stackLabel', expectedValues({ server: {} }).stackLabel, null);

// ─────────────────────────────────────────────────────────────────────────
// 3. diagnose() — no input at all
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({});
  has('empty config: flags no_input', r.problems, 'no_input');
  eq('empty config: status is warn (medium, not high)', r.status, 'warn');
  ok('empty config: checklist still has generic guidance', r.checklist.length >= 3);
  ok('empty config: disclaimer is always present', r.disclaimer.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. diagnose() — missing / malformed Access-Control-Allow-Origin
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', requestUrl: 'https://api.myapp.com/data', method: 'GET' }, response: { acao: '' } });
  has('missing ACAO: flags missing_acao', r.problems, 'missing_acao');
  eq('missing ACAO: severity is high', severityOf(r.problems, 'missing_acao'), 'high');
  eq('missing ACAO: overall status is fail', r.status, 'fail');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com' }, response: { acao: 'https://a.com, https://b.com' } });
  has('comma-joined ACAO: flags multiple_acao_values', r.problems, 'multiple_acao_values');
  eq('comma-joined ACAO: severity is high', severityOf(r.problems, 'multiple_acao_values'), 'high');
}

// ─────────────────────────────────────────────────────────────────────────
// 5. diagnose() — wildcard / null origin
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', credentials: 'include' }, response: { acao: '*' } });
  has('ACAO "*" with credentials include: flags acao_wildcard_with_credentials', r.problems, 'acao_wildcard_with_credentials');
  eq('ACAO "*" with credentials include: severity is high', severityOf(r.problems, 'acao_wildcard_with_credentials'), 'high');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', credentials: 'omit' }, response: { acao: '*' } });
  lacks('ACAO "*" without credentials: no wildcard/credentials problem', r.problems, 'acao_wildcard_with_credentials');
  eq('ACAO "*" without credentials: status is pass', r.status, 'pass');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com' }, response: { acao: 'null' } });
  has('ACAO "null": flags acao_null_origin', r.problems, 'acao_null_origin');
  eq('ACAO "null": severity is high', severityOf(r.problems, 'acao_null_origin'), 'high');
}

// ─────────────────────────────────────────────────────────────────────────
// 6. diagnose() — origin mismatch (byte-for-byte)
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com' }, response: { acao: 'https://myapp.com:8080' } });
  has('port mismatch: flags acao_origin_mismatch', r.problems, 'acao_origin_mismatch');
  eq('port mismatch: severity is high', severityOf(r.problems, 'acao_origin_mismatch'), 'high');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://www.myapp.com' }, response: { acao: 'https://myapp.com' } });
  has('www vs apex: flags acao_origin_mismatch', r.problems, 'acao_origin_mismatch');
  ok('www vs apex: message names the www/apex mismatch', messageOf(r.problems, 'acao_origin_mismatch').includes('www vs. apex mismatch'));
}

{
  const r = diagnose({ request: { pageOrigin: 'http://localhost:3000' }, response: { acao: 'http://127.0.0.1:3000' } });
  has('localhost vs 127.0.0.1 in ACAO: flags localhost_vs_loopback_ip', r.problems, 'localhost_vs_loopback_ip');
  eq('localhost vs 127.0.0.1 in ACAO: severity is medium', severityOf(r.problems, 'localhost_vs_loopback_ip'), 'medium');
  lacks('localhost vs 127.0.0.1 in ACAO: not also flagged as the generic high mismatch', r.problems, 'acao_origin_mismatch');
}

// ─────────────────────────────────────────────────────────────────────────
// 7. diagnose() — ACAO matches: credentials + Vary checks
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', credentials: 'include' }, response: { acao: 'https://myapp.com', acac: '' } });
  has('matching ACAO, credentials include, no ACAC: flags missing_acac', r.problems, 'missing_acac');
  eq('matching ACAO, credentials include, no ACAC: severity is high', severityOf(r.problems, 'missing_acac'), 'high');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', credentials: 'include' }, response: { acao: 'https://myapp.com', acac: 'true' } });
  lacks('matching ACAO with ACAC true: no missing_acac', r.problems, 'missing_acac');
  has('matching ACAO with ACAC true but no Vary: flags vary_origin_missing', r.problems, 'vary_origin_missing');
  eq('vary_origin_missing severity is low', severityOf(r.problems, 'vary_origin_missing'), 'low');
  eq('vary_origin_missing alone: status is warn', r.status, 'warn');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', credentials: 'include' }, response: { acao: 'https://myapp.com', acac: 'true', vary: 'Origin' } });
  eq('fully correct simple credentialed request: status is pass', r.status, 'pass');
  eq('fully correct simple credentialed request: no problems at all', r.problems.length, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// 8. diagnose() — preflight status
// ─────────────────────────────────────────────────────────────────────────

const PREFLIGHT_BASE = { request: { pageOrigin: 'https://myapp.com', method: 'PUT' }, response: { acao: 'https://myapp.com' } };

{
  const r = diagnose({ ...PREFLIGHT_BASE, response: { ...PREFLIGHT_BASE.response, preflightStatus: null } });
  has('preflight needed, status unknown: flags preflight_status_unknown', r.problems, 'preflight_status_unknown');
  eq('preflight_status_unknown severity is low', severityOf(r.problems, 'preflight_status_unknown'), 'low');
}

{
  const r = diagnose({ ...PREFLIGHT_BASE, response: { ...PREFLIGHT_BASE.response, preflightStatus: 403 } });
  has('preflight returns 403: flags preflight_status_not_ok', r.problems, 'preflight_status_not_ok');
  eq('preflight_status_not_ok severity is high', severityOf(r.problems, 'preflight_status_not_ok'), 'high');
  eq('preflight returns 403: overall status is fail', r.status, 'fail');
}

{
  const r = diagnose({ ...PREFLIGHT_BASE, response: { ...PREFLIGHT_BASE.response, preflightStatus: 204, acam: '' } });
  has('preflight 204 but no ACAM: flags preflight_missing_acam', r.problems, 'preflight_missing_acam');
  eq('preflight_missing_acam severity is high', severityOf(r.problems, 'preflight_missing_acam'), 'high');
}

{
  const r = diagnose({ ...PREFLIGHT_BASE, request: { ...PREFLIGHT_BASE.request, credentials: 'include' }, response: { ...PREFLIGHT_BASE.response, acac: 'true', preflightStatus: 204, acam: '*' } });
  has('ACAM "*" with credentials include: flags acam_wildcard_with_credentials', r.problems, 'acam_wildcard_with_credentials');
}

{
  const r = diagnose({ ...PREFLIGHT_BASE, response: { ...PREFLIGHT_BASE.response, preflightStatus: 204, acam: 'GET, POST' } });
  has('ACAM missing the actual method (PUT): flags method_not_in_acam', r.problems, 'method_not_in_acam');
  eq('method_not_in_acam severity is high', severityOf(r.problems, 'method_not_in_acam'), 'high');
}

{
  const r = diagnose({ ...PREFLIGHT_BASE, response: { ...PREFLIGHT_BASE.response, preflightStatus: 204, acam: 'PUT, OPTIONS' } });
  lacks('ACAM including PUT: no method_not_in_acam', r.problems, 'method_not_in_acam');
}

// ─────────────────────────────────────────────────────────────────────────
// 9. diagnose() — preflight: custom headers vs Access-Control-Allow-Headers
// ─────────────────────────────────────────────────────────────────────────

const HEADER_BASE = { request: { pageOrigin: 'https://myapp.com', method: 'PUT', customHeaders: ['Authorization'] }, response: { acao: 'https://myapp.com', preflightStatus: 204, acam: 'PUT, OPTIONS' } };

{
  const r = diagnose({ ...HEADER_BASE, response: { ...HEADER_BASE.response, acah: '' } });
  has('custom header sent, ACAH empty: flags preflight_missing_acah', r.problems, 'preflight_missing_acah');
  eq('preflight_missing_acah severity is high', severityOf(r.problems, 'preflight_missing_acah'), 'high');
}

{
  const r = diagnose({ ...HEADER_BASE, response: { ...HEADER_BASE.response, acah: 'Content-Type' } });
  has('ACAH missing Authorization: flags header_not_in_acah', r.problems, 'header_not_in_acah');
  ok('header_not_in_acah message names the missing header', messageOf(r.problems, 'header_not_in_acah').includes('Authorization'));
}

{
  const r = diagnose({ ...HEADER_BASE, response: { ...HEADER_BASE.response, acah: 'Authorization, Content-Type' } });
  lacks('ACAH including Authorization: no header_not_in_acah', r.problems, 'header_not_in_acah');
}

{
  const r = diagnose({ ...HEADER_BASE, request: { ...HEADER_BASE.request, credentials: 'include' }, response: { ...HEADER_BASE.response, acac: 'true', acah: '*' } });
  has('ACAH "*" with credentials include: flags acah_wildcard_with_credentials', r.problems, 'acah_wildcard_with_credentials');
}

// ─────────────────────────────────────────────────────────────────────────
// 10. diagnose() — redirect during a preflighted request
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', method: 'PUT' }, response: { acao: 'https://myapp.com', preflightStatus: 204, acam: 'PUT, OPTIONS', redirectsToOtherOrigin: true } });
  has('redirect to another origin during preflight: flags preflight_redirect', r.problems, 'preflight_redirect');
  eq('preflight_redirect severity is high', severityOf(r.problems, 'preflight_redirect'), 'high');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', method: 'GET' }, response: { acao: 'https://myapp.com', redirectsToOtherOrigin: true } });
  lacks('redirect flag on a simple GET (no preflight): no preflight_redirect', r.problems, 'preflight_redirect');
}

// ─────────────────────────────────────────────────────────────────────────
// 11. diagnose() — 4xx/5xx response with no CORS headers
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com' }, response: { acao: '', status: 500 } });
  has('500 with no ACAO: still flags missing_acao', r.problems, 'missing_acao');
  has('500 with no ACAO: also flags error_status_no_cors_headers', r.problems, 'error_status_no_cors_headers');
  eq('error_status_no_cors_headers severity is medium', severityOf(r.problems, 'error_status_no_cors_headers'), 'medium');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com' }, response: { acao: 'https://myapp.com', status: 500 } });
  lacks('500 WITH a correct ACAO present: no error_status_no_cors_headers', r.problems, 'error_status_no_cors_headers');
}

// ─────────────────────────────────────────────────────────────────────────
// 12. diagnose() — localhost vs 127.0.0.1 between the page and the request URL
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'http://localhost:3000', requestUrl: 'http://127.0.0.1:3000/api' }, response: { acao: 'http://localhost:3000' } });
  has('page on localhost, API called on 127.0.0.1 (same port): flags localhost_vs_loopback_ip', r.problems, 'localhost_vs_loopback_ip');
  eq('localhost_vs_loopback_ip (request vs page) severity is medium', severityOf(r.problems, 'localhost_vs_loopback_ip'), 'medium');
}

{
  const r = diagnose({ request: { pageOrigin: 'http://localhost:3000', requestUrl: 'http://localhost:8000/api' }, response: { acao: 'http://localhost:3000' } });
  lacks('page and API both on localhost (different port only): no localhost_vs_loopback_ip', r.problems, 'localhost_vs_loopback_ip');
}

// ─────────────────────────────────────────────────────────────────────────
// 13. diagnose() — cross-site cookies need SameSite=None; Secure
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', requestUrl: 'https://api.other.com/x', credentials: 'include' }, response: { acao: 'https://myapp.com', acac: 'true' } });
  has('credentials include, cross-host API: flags samesite_none_secure_needed', r.problems, 'samesite_none_secure_needed');
  eq('samesite_none_secure_needed severity is medium', severityOf(r.problems, 'samesite_none_secure_needed'), 'medium');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', requestUrl: 'https://myapp.com/api/x', credentials: 'include' }, response: { acao: 'https://myapp.com', acac: 'true' } });
  lacks('credentials include but same host: no samesite_none_secure_needed', r.problems, 'samesite_none_secure_needed');
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', requestUrl: 'https://api.other.com/x', credentials: 'omit' }, response: { acao: 'https://myapp.com' } });
  lacks('credentials omit, cross-host API: no samesite_none_secure_needed', r.problems, 'samesite_none_secure_needed');
}

// ─────────────────────────────────────────────────────────────────────────
// 14. diagnose() — pasted console error only (message classifier)
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({
    error: { message: "Access to fetch at 'https://api.myapp.com/x' from origin 'https://myapp.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource." },
    request: { pageOrigin: 'https://myapp.com' },
  });
  has('pasted "No ACAO header" message: flags missing_acao', r.problems, 'missing_acao');
  eq('message and structured checks dedupe to one missing_acao entry', r.problems.filter((p) => p.code === 'missing_acao').length, 1);
}

{
  const r = diagnose({
    error: { message: 'Request header field x-api-key is not allowed by Access-Control-Allow-Headers in the response.' },
    request: { pageOrigin: 'https://myapp.com' },
  });
  has('pasted "header field not allowed" message alone: flags header_not_in_acah', r.problems, 'header_not_in_acah');
  ok('header_not_in_acah message captures the header name from the pasted text', messageOf(r.problems, 'header_not_in_acah').includes('x-api-key'));
}

{
  const r = diagnose({
    error: { message: 'Method DELETE is not allowed by Access-Control-Allow-Methods in preflight response.' },
    request: { pageOrigin: 'https://myapp.com' },
  });
  has('pasted "method not allowed" message alone: flags method_not_in_acam', r.problems, 'method_not_in_acam');
  ok('method_not_in_acam message captures the method from the pasted text', messageOf(r.problems, 'method_not_in_acam').includes('DELETE'));
}

{
  const r = diagnose({
    error: { message: 'Redirect is not allowed for a preflight request.' },
    request: { pageOrigin: 'https://myapp.com' },
  });
  has('pasted redirect message alone (no structured preflight data): flags preflight_redirect', r.problems, 'preflight_redirect');
}

{
  const r = diagnose({
    error: { message: "The 'Access-Control-Allow-Origin' header has a value 'https://old.example.com' that is not equal to the supplied origin." },
    request: { requestUrl: 'https://api.myapp.com/x' },
  });
  has('pasted ACAO-mismatch message: flags acao_origin_mismatch', r.problems, 'acao_origin_mismatch');
  ok('acao_origin_mismatch message captures the offending value', messageOf(r.problems, 'acao_origin_mismatch').includes('https://old.example.com'));
}

{
  const r = diagnose({ error: { message: 'CORS request not http' }, request: { pageOrigin: 'https://myapp.com' } });
  has('pasted "not http" message: flags not_http', r.problems, 'not_http');
  eq('not_http severity is medium', severityOf(r.problems, 'not_http'), 'medium');
}

{
  const r = diagnose({
    error: { message: "Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '*'." },
    request: { pageOrigin: 'https://myapp.com' },
  });
  has('pasted wildcard+credentials message (Firefox phrasing): flags acao_wildcard_with_credentials', r.problems, 'acao_wildcard_with_credentials');
}

{
  const r = diagnose({
    error: { message: "The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'." },
    request: { pageOrigin: 'https://myapp.com' },
  });
  has('pasted wildcard+credentials message (Chrome phrasing): flags acao_wildcard_with_credentials', r.problems, 'acao_wildcard_with_credentials');
}

// ─────────────────────────────────────────────────────────────────────────
// 15. sortProblems() — high severity always sorts first regardless of push order
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({
    request: { pageOrigin: 'https://myapp.com', credentials: 'include' },
    response: { acao: 'https://myapp.com', acac: 'true' }, // low: vary_origin_missing, pushed via the "matches" branch
    server: {},
  });
  // add a high-severity one on top by also breaking the origin match
  const r2 = diagnose({
    error: { message: 'CORS request not http' }, // medium, message-derived, pushed last
    request: { pageOrigin: 'https://myapp.com' },
    response: { acao: '' }, // high: missing_acao, pushed first
  });
  eq('sorted problems: first entry is high severity', r2.problems[0].severity, 'high');
  eq('sorted problems: last entry is not higher severity than the first', SEVERITY_RANK(r2.problems[r2.problems.length - 1].severity) >= SEVERITY_RANK(r2.problems[0].severity), true);
  ok('vary-only diagnosis sorts to a single low-severity entry', r.problems.length === 1 && r.problems[0].severity === 'low');
}

function SEVERITY_RANK(s) {
  return { high: 0, medium: 1, low: 2 }[s];
}

// ─────────────────────────────────────────────────────────────────────────
// 16. diagnose() — checklist and disclaimer are always populated
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com', method: 'PUT' }, response: { acao: 'https://myapp.com', preflightStatus: 204, acam: 'PUT, OPTIONS' } });
  ok('checklist names why a preflight is needed once one is', r.checklist.some((c) => c.toLowerCase().includes('preflight')));
}

{
  const r = diagnose({ request: { pageOrigin: 'https://myapp.com' }, response: { acao: 'https://myapp.com', acac: 'true', vary: 'Origin' } });
  ok('checklist has generic guidance even on a clean pass', r.checklist.length >= 3);
  ok('disclaimer is a non-empty string', typeof r.disclaimer === 'string' && r.disclaimer.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
