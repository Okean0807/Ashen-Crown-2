#!/usr/bin/env node
/**
 * Diagnostic script: traces the exact network redirect/response chain during
 * ASHEN CROWN boot and determines whether any HTTP 403 / auth failure happens
 * BEFORE or AFTER React mounts into #root.
 *
 * Read-only diagnostic tool — does NOT modify app code or RC build.
 *
 * Usage:
 *   node scripts/diagnose-boot-403.mjs [url1] [url2 ...]
 *
 * Default targets:
 *   1. https://ais-dev-on732n7bwv63slck3xpbuf-561696380231.europe-west2.run.app/?diag=1
 *   2. http://127.0.0.1:3000/?diag=1
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [
    'playwright',
    '/usr/local/share/bun-global/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try next location
    }
  }
  throw new Error(
    'Playwright not found. Install playwright or run in an environment with Playwright available.'
  );
}

const DEFAULT_TARGETS = [
  {
    label: 'AIS_DEV_CLOUD_RUN',
    url: 'https://ais-dev-on732n7bwv63slck3xpbuf-561696380231.europe-west2.run.app/?diag=1',
  },
  {
    label: 'LOCAL_UPSTREAM_3000',
    url: 'http://127.0.0.1:3000/?diag=1',
  },
];

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

async function traceTarget(browser, { label, url }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  });

  const page = await context.newPage();
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  // Inject mount detector before any page script runs
  await page.addInitScript(() => {
    const startTs = performance.now();
    const state = {
      href: window.location.href,
      origin: window.location.origin,
      domContentLoadedMs: null,
      rootFoundMs: null,
      reactMountedMs: null,
      rootChildCount: 0,
      documentTitle: '',
    };
    window.__BOOT_DIAG__ = state;

    const checkRoot = () => {
      const root = document.getElementById('root');
      if (root) {
        if (state.rootFoundMs === null) {
          state.rootFoundMs = Math.round(performance.now() - startTs);
        }
        state.rootChildCount = root.childElementCount;
        if (root.childElementCount > 0 && state.reactMountedMs === null) {
          state.reactMountedMs = Math.round(performance.now() - startTs);
          state.documentTitle = document.title;
        }
      }
    };

    const observer = new MutationObserver(() => checkRoot());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('DOMContentLoaded', () => {
      state.domContentLoadedMs = Math.round(performance.now() - startTs);
      state.documentTitle = document.title;
      checkRoot();
    });
  });

  const events = [];
  let reactMountedWallMs = null;
  let appDocumentLoadedWallMs = null;
  let appBundleRequested = false;

  const currentPhase = () => {
    if (reactMountedWallMs !== null) return 'POST_REACT_MOUNT';
    if (appDocumentLoadedWallMs !== null) return 'APP_HTML_PRE_MOUNT';
    return 'PRE_APP_DOCUMENT';
  };

  page.on('request', (req) => {
    const reqUrl = req.url();
    if (/\/src\/main\.tsx|\/assets\/index-.*\.js/.test(reqUrl)) {
      appBundleRequested = true;
    }
  });

  page.on('response', async (res) => {
    const req = res.request();
    const resUrl = res.url();
    const status = res.status();
    const headers = res.headers();
    const resourceType = req.resourceType();

    // Check if the actual Ashen Crown app HTML was served (status 200, not cookie check or Google auth)
    if (
      resourceType === 'document' &&
      status === 200 &&
      !/__cookie_check\.html|accounts\.google\.com|aistudio\.google\.com/.test(resUrl)
    ) {
      appDocumentLoadedWallMs = elapsed();
    }

    // Opportunistically sample React mount state on document/script responses
    if (reactMountedWallMs === null && (resourceType === 'script' || resourceType === 'document')) {
      try {
        const diag = await page.evaluate(() => window.__BOOT_DIAG__ ?? null);
        if (diag && diag.reactMountedMs !== null) {
          reactMountedWallMs = elapsed();
        }
      } catch {
        // Page may be mid-navigation across origins
      }
    }

    events.push({
      tMs: elapsed(),
      phase: currentPhase(),
      method: req.method(),
      status,
      resourceType,
      isNavigation: req.isNavigationRequest(),
      url: resUrl,
      location: headers['location'] || null,
      server: headers['server'] || null,
      contentType: headers['content-type'] || null,
      setCookiePresent: Boolean(headers['set-cookie']),
    });
  });

  page.on('requestfailed', (req) => {
    events.push({
      tMs: elapsed(),
      phase: currentPhase(),
      method: req.method(),
      status: 'FAILED',
      resourceType: req.resourceType(),
      isNavigation: req.isNavigationRequest(),
      url: req.url(),
      location: null,
      server: null,
      contentType: null,
      errorText: req.failure()?.errorText || 'unknown',
    });
  });

  let navigationError = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (err) {
    navigationError = String(err?.message || err);
  }

  // Give any client-side JS redirects (like /__cookie_check.html -> return_url) time to settle
  await page.waitForTimeout(2500);

  let finalBootDiag = null;
  let finalUrl = page.url();
  let finalTitle = '';
  try {
    finalTitle = await page.title();
    finalBootDiag = await page.evaluate(() => {
      const root = document.getElementById('root');
      const d = window.__BOOT_DIAG__ || {};
      return {
        ...d,
        finalHref: window.location.href,
        hasRootElement: Boolean(root),
        rootChildCountNow: root ? root.childElementCount : 0,
        bodyTextSnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      };
    });
    if (finalBootDiag?.rootChildCountNow > 0 && reactMountedWallMs === null) {
      reactMountedWallMs = elapsed();
    }
  } catch (err) {
    finalBootDiag = { evalError: String(err?.message || err) };
  }

  const forbiddenEvents = events.filter((e) => e.status === 403);
  const authRedirectEvents = events.filter(
    (e) =>
      (e.location && /__cookie_check|applet-auth|accounts\.google\.com|aistudio\.google\.com/.test(e.location)) ||
      /__cookie_check|applet-auth|accounts\.google\.com/.test(e.url)
  );
  const reactMounted = Boolean(finalBootDiag?.rootChildCountNow > 0 || reactMountedWallMs !== null);

  let verdict;
  if (forbiddenEvents.length > 0) {
    const first403 = forbiddenEvents[0];
    verdict =
      first403.phase === 'POST_REACT_MOUNT'
        ? 'AFTER_REACT_MOUNT (HTTP 403 occurred after React mounted #root)'
        : `BEFORE_REACT_MOUNT (HTTP 403 occurred during ${first403.phase} at ${first403.url})`;
  } else if (!reactMounted && authRedirectEvents.length > 0) {
    verdict =
      'BEFORE_REACT_MOUNT (Blocked by upstream AI Studio/Google auth redirect chain before app HTML/JS loaded)';
  } else if (reactMounted) {
    verdict = 'NO_403_CLEAN_MOUNT (App HTML loaded and React mounted cleanly into #root with zero 403 errors)';
  } else {
    verdict = 'BEFORE_REACT_MOUNT (React did not mount; inspect trace)';
  }

  await context.close();

  return {
    label,
    requestedUrl: url,
    finalUrl,
    finalTitle,
    navigationError,
    appDocumentLoaded: appDocumentLoadedWallMs !== null,
    appBundleRequested,
    reactMounted,
    reactMountedWallMs,
    forbiddenCount: forbiddenEvents.length,
    authRedirectCount: authRedirectEvents.length,
    verdict,
    finalBootDiag,
    networkPath: events,
  };
}

async function main() {
  const cliUrls = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets =
    cliUrls.length > 0
      ? cliUrls.map((u, idx) => ({ label: `TARGET_${idx + 1}`, url: u }))
      : DEFAULT_TARGETS;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];
  try {
    for (const target of targets) {
      const report = await traceTarget(browser, target);
      results.push(report);

      console.log(`\n================================================================`);
      console.log(`TARGET: ${report.label}`);
      console.log(`Requested URL : ${report.requestedUrl}`);
      console.log(`Final URL     : ${report.finalUrl}`);
      console.log(`Final Title   : ${report.finalTitle}`);
      console.log(`App HTML 200  : ${report.appDocumentLoaded}`);
      console.log(`App JS Loaded : ${report.appBundleRequested}`);
      console.log(`React Mounted : ${report.reactMounted} (root children: ${report.finalBootDiag?.rootChildCountNow ?? 0})`);
      console.log(`HTTP 403 Count: ${report.forbiddenCount}`);
      console.log(`VERDICT       : ${report.verdict}`);
      console.log(`----------------------------------------------------------------`);
      console.log(`EXACT NETWORK PATH (${report.networkPath.length} events):`);
      for (const ev of report.networkPath) {
        const loc = ev.location ? ` -> Location: ${ev.location}` : '';
        const srv = ev.server ? ` [${ev.server}]` : '';
        const nav = ev.isNavigation ? ' [NAV]' : '';
        console.log(
          `  +${String(ev.tMs).padStart(5, ' ')}ms | ${ev.phase.padEnd(18, ' ')} | ${String(ev.status).padEnd(6, ' ')} | ${ev.resourceType.padEnd(10, ' ')}${nav} | ${ev.url}${loc}${srv}`
        );
      }
      if (report.finalBootDiag?.bodyTextSnippet) {
        console.log(`Final Body    : "${report.finalBootDiag.bodyTextSnippet}"`);
      }
    }
  } finally {
    await browser.close();
  }

  // Optional JSON dump if --json=<path> is passed
  const jsonFlag = process.argv.find((a) => a.startsWith('--json='));
  if (jsonFlag) {
    const outPath = jsonFlag.slice('--json='.length);
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nSaved JSON trace to ${outPath}`);
  }
}

main().catch((err) => {
  console.error('Diagnostic script error:', err);
  process.exit(1);
});
