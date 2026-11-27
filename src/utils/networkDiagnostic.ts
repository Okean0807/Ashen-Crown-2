/**
 * Temporary boot-sequence network diagnostic fetch-interceptor.
 * Monitors outgoing fetch() calls and early PerformanceResourceTiming entries
 * before and after React mounts into #root, logging activity to the console
 * and a temporary diagnostic state (window.__ASHEN_NET_DIAG__).
 *
 * Non-invasive: returns original Response objects untouched and does not
 * alter gameplay logic, src/core/*, or v14.2 rules.
 */

export type BootDiagnosticPhase = 'PRE_REACT_MOUNT' | 'POST_REACT_MOUNT';

export type ForbiddenOriginHint = 'APPLET_AUTH_GATEWAY' | 'BACKEND_OR_OTHER';

export interface NetworkDiagnosticEntry {
  id: number;
  source: 'fetch' | 'navigation' | 'resource';
  tMs: number;
  phase: BootDiagnosticPhase;
  method: string;
  url: string;
  finalUrl: string | null;
  status: number | null;
  ok: boolean | null;
  redirected: boolean;
  durationMs: number;
  error: string | null;
  responseHeaders?: Record<string, string> | null;
  responseBodySnippet?: string | null;
  originHint?: ForbiddenOriginHint | null;
}

export interface NetworkDiagnosticState {
  initialized: boolean;
  startedAtIso: string;
  bootUrl: string;
  phase: BootDiagnosticPhase;
  reactMountedAtMs: number | null;
  totalRequests: number;
  forbiddenCount: number;
  first403: NetworkDiagnosticEntry | null;
  entries: NetworkDiagnosticEntry[];
}

declare global {
  interface Window {
    __ASHEN_NET_DIAG__?: NetworkDiagnosticState;
  }
}

const MAX_DIAGNOSTIC_ENTRIES = 200;
const MAX_403_BODY_CHARS = 2000;

let originalFetch: typeof window.fetch | null = null;
let originalFetchDescriptor: PropertyDescriptor | undefined;
let fetchPatched = false;
let bootT0 = 0;
let nextEntryId = 1;
let mountObserver: MutationObserver | null = null;
let perfObserver: PerformanceObserver | null = null;

const diagnosticState: NetworkDiagnosticState = {
  initialized: false,
  startedAtIso: '',
  bootUrl: '',
  phase: 'PRE_REACT_MOUNT',
  reactMountedAtMs: null,
  totalRequests: 0,
  forbiddenCount: 0,
  first403: null,
  entries: [],
};

function elapsedMs(): number {
  return Math.round(performance.now() - bootT0);
}

function extractRequestMeta(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  if (typeof input === 'string') {
    return { method: (init?.method ?? 'GET').toUpperCase(), url: input };
  }
  if (input instanceof URL) {
    return { method: (init?.method ?? 'GET').toUpperCase(), url: input.toString() };
  }
  return {
    method: (init?.method ?? input.method ?? 'GET').toUpperCase(),
    url: input.url,
  };
}

function extractResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
  } catch {
    // Ignore if headers are inaccessible (e.g., opaque response)
  }
  return headers;
}

async function readClonedBodySnippet(response: Response): Promise<string | null> {
  try {
    if (response.type === 'opaque' || response.bodyUsed) {
      return null;
    }
    const text = await response.clone().text();
    if (!text) {
      return '';
    }
    return text.length > MAX_403_BODY_CHARS
      ? `${text.slice(0, MAX_403_BODY_CHARS)}… [truncated ${text.length} chars]`
      : text;
  } catch {
    return null;
  }
}

function classifyForbiddenOrigin(
  requestUrl: string,
  finalUrl: string,
  headers: Record<string, string>,
  bodySnippet: string | null
): ForbiddenOriginHint {
  const server = headers['server'] ?? '';
  const combined = `${requestUrl} ${finalUrl} ${server} ${bodySnippet ?? ''}`;
  if (/applet-auth|aistudio\.google\.com|accounts\.google\.com|Google Frontend/i.test(combined)) {
    return 'APPLET_AUTH_GATEWAY';
  }
  return 'BACKEND_OR_OTHER';
}

function recordEntry(entry: NetworkDiagnosticEntry): void {
  diagnosticState.totalRequests += 1;
  diagnosticState.entries.push(entry);
  if (diagnosticState.entries.length > MAX_DIAGNOSTIC_ENTRIES) {
    diagnosticState.entries.shift();
  }

  if (entry.status === 403) {
    diagnosticState.forbiddenCount += 1;
    if (!diagnosticState.first403) {
      diagnosticState.first403 = entry;
    }
    const hintLabel = entry.originHint ? `[${entry.originHint}]` : '';
    console.error(
      `[NetDiag][403]${hintLabel}[${entry.phase}] +${entry.tMs}ms ${entry.method} ${entry.url}`,
      {
        finalUrl: entry.finalUrl,
        redirected: entry.redirected,
        originHint: entry.originHint ?? null,
        responseHeaders: entry.responseHeaders ?? null,
        responseBodySnippet: entry.responseBodySnippet ?? null,
        entry,
      }
    );
    return;
  }

  if (entry.error || (entry.status !== null && entry.status >= 400)) {
    console.warn(
      `[NetDiag][${entry.status ?? 'ERR'}][${entry.phase}] +${entry.tMs}ms ${entry.method} ${entry.url}`,
      entry
    );
    return;
  }

  console.info(
    `[NetDiag][${entry.status ?? 'OK'}][${entry.phase}] +${entry.tMs}ms ${entry.method} ${entry.url} (${entry.durationMs}ms)`
  );
}

function recordResourceTiming(
  res: PerformanceResourceTiming & { responseStatus?: number },
  phaseOverride?: BootDiagnosticPhase
): void {
  const status = typeof res.responseStatus === 'number' && res.responseStatus > 0 ? res.responseStatus : null;
  recordEntry({
    id: nextEntryId++,
    source: 'resource',
    tMs: Math.round(res.startTime),
    phase: phaseOverride ?? diagnosticState.phase,
    method: (res.initiatorType || 'RESOURCE').toUpperCase(),
    url: res.name,
    finalUrl: res.name,
    status,
    ok: status !== null ? status >= 200 && status < 400 : null,
    redirected: false,
    durationMs: Math.round(res.duration),
    error: null,
  });
}

function capturePreJsPerformanceEntries(): void {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return;
  }

  const navEntries = performance.getEntriesByType('navigation') as Array<
    PerformanceNavigationTiming & { responseStatus?: number }
  >;
  for (const nav of navEntries) {
    const status = typeof nav.responseStatus === 'number' && nav.responseStatus > 0 ? nav.responseStatus : null;
    recordEntry({
      id: nextEntryId++,
      source: 'navigation',
      tMs: Math.round(nav.startTime),
      phase: 'PRE_REACT_MOUNT',
      method: 'NAV',
      url: nav.name,
      finalUrl: nav.name,
      status,
      ok: status !== null ? status >= 200 && status < 400 : null,
      redirected: nav.redirectCount > 0,
      durationMs: Math.round(nav.duration),
      error: null,
    });
  }

  const resourceEntries = performance.getEntriesByType('resource') as Array<
    PerformanceResourceTiming & { responseStatus?: number }
  >;
  for (const res of resourceEntries) {
    recordResourceTiming(res, 'PRE_REACT_MOUNT');
  }
}

function startResourcePerformanceObserver(includeFetchOnly: boolean): void {
  if (typeof PerformanceObserver === 'undefined') {
    return;
  }
  try {
    perfObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const res = entry as PerformanceResourceTiming & { responseStatus?: number };
        if (includeFetchOnly && res.initiatorType !== 'fetch' && res.initiatorType !== 'xmlhttprequest') {
          continue;
        }
        recordResourceTiming(res);
      }
    });
    perfObserver.observe({ type: 'resource', buffered: false });
  } catch {
    perfObserver = null;
  }
}

export function markReactMounted(): void {
  if (diagnosticState.phase === 'POST_REACT_MOUNT') {
    return;
  }
  diagnosticState.phase = 'POST_REACT_MOUNT';
  diagnosticState.reactMountedAtMs = elapsedMs();
  if (mountObserver) {
    mountObserver.disconnect();
    mountObserver = null;
  }
  console.info(
    `[NetDiag][BOOT] React mounted into #root at +${diagnosticState.reactMountedAtMs}ms (pre-mount requests: ${diagnosticState.totalRequests}, 403s: ${diagnosticState.forbiddenCount})`
  );
}

export function observeReactMount(rootEl: HTMLElement | null): void {
  if (!rootEl) {
    return;
  }
  if (rootEl.childElementCount > 0) {
    markReactMounted();
    return;
  }
  if (mountObserver) {
    mountObserver.disconnect();
  }
  mountObserver = new MutationObserver(() => {
    if (rootEl.childElementCount > 0) {
      markReactMounted();
    }
  });
  mountObserver.observe(rootEl, { childList: true });
}

export function initNetworkDiagnostic(): NetworkDiagnosticState {
  if (typeof window === 'undefined') {
    return diagnosticState;
  }
  if (diagnosticState.initialized) {
    return diagnosticState;
  }

  bootT0 = performance.now();
  diagnosticState.initialized = true;
  diagnosticState.startedAtIso = new Date().toISOString();
  diagnosticState.bootUrl = window.location.href;
  diagnosticState.phase = 'PRE_REACT_MOUNT';
  diagnosticState.reactMountedAtMs = null;
  window.__ASHEN_NET_DIAG__ = diagnosticState;

  console.info(
    `[NetDiag][INIT] Network diagnostic initialized before React mount at ${diagnosticState.bootUrl}`
  );

  capturePreJsPerformanceEntries();

  if (typeof window.fetch === 'function') {
    const baseFetch = window.fetch.bind(window);
    originalFetch = baseFetch;
    originalFetchDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch');

    const wrappedFetch: typeof window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const { method, url } = extractRequestMeta(input, init);
      const reqStart = performance.now();
      const phaseAtStart = diagnosticState.phase;
      const tMs = elapsedMs();

      try {
        const response = await baseFetch(input, init);
        let responseHeaders: Record<string, string> | null = null;
        let responseBodySnippet: string | null = null;
        let originHint: ForbiddenOriginHint | null = null;

        if (response.status === 403) {
          responseHeaders = extractResponseHeaders(response);
          responseBodySnippet = await readClonedBodySnippet(response);
          originHint = classifyForbiddenOrigin(url, response.url || url, responseHeaders, responseBodySnippet);
        }

        recordEntry({
          id: nextEntryId++,
          source: 'fetch',
          tMs,
          phase: phaseAtStart,
          method,
          url,
          finalUrl: response.url || url,
          status: response.status,
          ok: response.ok,
          redirected: response.redirected,
          durationMs: Math.round(performance.now() - reqStart),
          error: null,
          ...(response.status === 403
            ? { responseHeaders, responseBodySnippet, originHint }
            : {}),
        });
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordEntry({
          id: nextEntryId++,
          source: 'fetch',
          tMs,
          phase: phaseAtStart,
          method,
          url,
          finalUrl: null,
          status: null,
          ok: false,
          redirected: false,
          durationMs: Math.round(performance.now() - reqStart),
          error: message,
        });
        throw err;
      }
    };

    try {
      const canRedefine = !originalFetchDescriptor || originalFetchDescriptor.configurable !== false;
      const hasSetter = Boolean(originalFetchDescriptor?.set) || Boolean(originalFetchDescriptor?.writable);

      if (hasSetter) {
        window.fetch = wrappedFetch;
        fetchPatched = true;
      } else if (canRedefine) {
        Object.defineProperty(window, 'fetch', {
          value: wrappedFetch,
          configurable: true,
          writable: true,
          enumerable: originalFetchDescriptor?.enumerable ?? true,
        });
        fetchPatched = true;
      } else {
        fetchPatched = false;
      }
    } catch {
      fetchPatched = false;
    }

    if (!fetchPatched) {
      console.warn(
        '[NetDiag][FALLBACK] window.fetch is read-only/non-configurable in this runtime; monitoring fetch/resource requests via PerformanceObserver instead.'
      );
      startResourcePerformanceObserver(false);
    }
  } else {
    startResourcePerformanceObserver(false);
  }

  return diagnosticState;
}

export function getNetworkDiagnosticState(): NetworkDiagnosticState {
  return diagnosticState;
}

export function uninstallNetworkDiagnostic(): void {
  if (typeof window !== 'undefined' && fetchPatched) {
    try {
      if (originalFetchDescriptor) {
        Object.defineProperty(window, 'fetch', originalFetchDescriptor);
      } else if (originalFetch) {
        window.fetch = originalFetch;
      }
    } catch {
      // Ignore if environment locked fetch after init
    }
    fetchPatched = false;
    originalFetch = null;
    originalFetchDescriptor = undefined;
  }
  if (mountObserver) {
    mountObserver.disconnect();
    mountObserver = null;
  }
  if (perfObserver) {
    perfObserver.disconnect();
    perfObserver = null;
  }
  diagnosticState.initialized = false;
}
