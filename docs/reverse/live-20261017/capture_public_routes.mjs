// Authorized, non-invasive public-page capture for novix.science.
// No login, auth bypass, form submission, paid task, or response-body reading.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/cz/code/code/codex/idea2paper_product-dev-v4.0/web/node_modules/playwright');
const OUT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(OUT, 'screenshots');
const BASE = 'https://novix.science';
const ROUTES = [
  '/', '/chat', '/deepsurvey', '/ideaspark', '/methoddesign', '/autoexperiment',
  '/notebook', '/reproduce', '/auto-discovery',
  '/account', '/account/upgrade', '/account/credit', '/account/billing',
  '/account/referrals', '/account/info', '/account/version-history', '/account/community',
  '/privacy', '/terms', '/contact', '/user-manual',
  '/register', '/debug/markdown', '/upgrade',
  '/search-v1/capture-probe', '/published/revision/capture-probe',
  '/definitely-not-a-real-route'
];
const routes = process.env.CAPTURE_ROUTES ? process.env.CAPTURE_ROUTES.split(',').filter(Boolean) : ROUTES;
const slug = r => r === '/' ? 'root' : r.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
const clean = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await fs.mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true, timeout: 30000 });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
const results = [];
for (const route of routes) {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(18000);
  page.setDefaultTimeout(8000);
  const network = [];
  const failures = [];
  // Status/metadata only. Never attach a response.body() handler.
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'fetch' || t === 'xhr') {
      network.push({ method: req.method(), url: clean(req.url()) });
    }
  });
  page.on('response', res => {
    const t = res.request().resourceType();
    if (t === 'fetch' || t === 'xhr') {
      network.push({
        method: res.request().method(),
        url: clean(res.url()),
        status: res.status()
      });
    }
  });
  page.on('requestfailed', req => {
    failures.push({ url: clean(req.url()), error: req.failure()?.errorText });
  });
  const capturedAt = new Date().toISOString();
  let response = null;
  let gotoError = null;
  let detail = {};
  let screenshotError = null;
  const started = Date.now();
  try {
    response = await page.goto(BASE + route, {
      waitUntil: 'domcontentloaded', timeout: 18000
    });
  } catch (err) {
    gotoError = String(err).split('\n')[0].slice(0, 500);
  }
  await sleep(1500);
  try {
    detail = await page.evaluate(() => {
      const text = el => {
        return (el.innerText || el.textContent || '')
          .replace(/\s+/g, ' ').trim();
      };
      const visible = el => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          r.width > 0 && r.height > 0;
      };
      const pick = (sel, max) => {
        return [...document.querySelectorAll(sel)]
          .filter(visible).slice(0, max);
      };
      const links = pick('a[href]', 200).map(a => ({
        text: text(a).slice(0, 160),
        href: a.href,
        ariaLabel: a.getAttribute('aria-label'),
        title: a.getAttribute('title')
      }));
      const buttons = pick('button,[role="button"]', 200).map(el => ({
        text: text(el).slice(0, 160), off: Boolean(el.disabled)
      }));
      const inputs = pick('input,textarea,select', 200).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
        off: Boolean(el.disabled)
      }));
      const headings = pick('h1,h2,h3,h4', 100).map(h => ({
        tag: h.tagName.toLowerCase(), text: text(h).slice(0, 200)
      }));
      return {
        title: document.title,
        lang: document.documentElement.lang,
        bodyText: (document.body?.innerText || '')
          .replace(/\s+/g, ' ').trim().slice(0, 20000),
        bodyTextLength: (document.body?.innerText || '').length,
        navLinks: links, buttons: buttons, inputs: inputs,
        headings: headings,
        documentReadyState: document.readyState,
        viewport: { width: innerWidth, height: innerHeight }
      };
    });
  } catch (err) {
    detail = { evaluateError: String(err).split('\n')[0].slice(0, 500) };
  }
  const shotRel = 'screenshots/' + slug(route) + '.png';
  try {
    await page.screenshot({
      path: path.join(OUT, shotRel), fullPage: false, timeout: 10000
    });
  } catch (err) {
    screenshotError = String(err).split('\n')[0].slice(0, 500);
  }
  results.push({
    requestedPath: route, finalUrl: page.url(),
    httpStatus: response ? response.status() : null,
    responseUrl: response ? response.url() : null,
    gotoError, capturedAt, elapsedMs: Date.now() - started,
    screenshot: shotRel, screenshotError,
    network: network.slice(0, 300),
    requestFailures: failures.slice(0, 100),
    ...detail
  });
  console.log(route + ' -> ' + page.url() + ' [' +
    (response ? response.status() : 'ERR') + '] ' +
    (detail.bodyTextLength || 0) + ' chars');
  await page.close();
}
await context.close();
await browser.close();
const manifest = {
  capturedAt: new Date().toISOString(), base: BASE,
  method: 'Playwright headless; domcontentloaded + 1500ms bounded settle; no auth; response bodies never read.',
  routeCount: results.length, results: results
};
await fs.writeFile(path.join(OUT, 'public_routes.json'),
  JSON.stringify(manifest, null, 2));
const summary = results.map(r => ({
  requestedPath: r.requestedPath, finalUrl: r.finalUrl,
  httpStatus: r.httpStatus, title: r.title,
  bodyTextLength: r.bodyTextLength,
  navLinks: (r.navLinks || []).length,
  buttons: (r.buttons || []).length,
  inputs: (r.inputs || []).length,
  screenshot: r.screenshot, error: r.gotoError || r.screenshotError || null
}));
await fs.writeFile(path.join(OUT, 'public_routes_summary.json'),
  JSON.stringify({ capturedAt: manifest.capturedAt, summary: summary }, null, 2));
console.log('Wrote ' + results.length + ' captures');
