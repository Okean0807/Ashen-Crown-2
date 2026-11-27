/**
 * Temporary startup reachability probe against a neutral public API
 * (JSONPlaceholder) to distinguish between an authenticated Google/AI Studio
 * domain restriction vs. a global outbound network restriction.
 *
 * Non-blocking and fault-tolerant: never throws or delays React mount,
 * and does not touch src/core/* or v14.2 gameplay rules.
 */

export type NeutralProbeDiagnosis =
  | 'PENDING'
  | 'NEUTRAL_API_REACHABLE'
  | 'NEUTRAL_API_HTTP_ERROR'
  | 'NEUTRAL_API_BLOCKED_OR_OFFLINE';

export interface NeutralNetworkProbeResult {
  url: string;
  startedAtIso: string;
  completedAtIso: string | null;
  durationMs: number | null;
  status: number | null;
  ok: boolean | null;
  contentType: string | null;
  bodySnippet: string | null;
  error: string | null;
  diagnosis: NeutralProbeDiagnosis;
}

declare global {
  interface Window {
    __ASHEN_NET_PROBE__?: NeutralNetworkProbeResult;
  }
}

export const DEFAULT_NEUTRAL_PROBE_URL = 'https://jsonplaceholder.typicode.com/todos/1';
const PROBE_TIMEOUT_MS = 6000;

let activeProbePromise: Promise<NeutralNetworkProbeResult> | null = null;

export function runNeutralNetworkProbe(
  url: string = DEFAULT_NEUTRAL_PROBE_URL
): Promise<NeutralNetworkProbeResult> {
  if (activeProbePromise) {
    return activeProbePromise;
  }

  const startedAt = performance.now();
  const state: NeutralNetworkProbeResult = {
    url,
    startedAtIso: new Date().toISOString(),
    completedAtIso: null,
    durationMs: null,
    status: null,
    ok: null,
    contentType: null,
    bodySnippet: null,
    error: null,
    diagnosis: 'PENDING',
  };

  if (typeof window !== 'undefined') {
    window.__ASHEN_NET_PROBE__ = state;
  }

  console.info(`[NetProbe][START] Testing neutral public API reachability: ${url}`);

  activeProbePromise = (async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(new Error(`Timeout after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller?.signal,
      });

      state.status = response.status;
      state.ok = response.ok;
      state.contentType = response.headers.get('content-type');
      try {
        const text = await response.text();
        state.bodySnippet = text.slice(0, 300);
      } catch {
        state.bodySnippet = null;
      }

      state.durationMs = Math.round(performance.now() - startedAt);
      state.completedAtIso = new Date().toISOString();
      state.diagnosis = response.ok ? 'NEUTRAL_API_REACHABLE' : 'NEUTRAL_API_HTTP_ERROR';

      if (response.ok) {
        console.info(
          `[NetProbe][OK] Neutral API reachable (${response.status}, ${state.durationMs}ms) — outbound HTTPS works; any 403 on Google/AI Studio endpoints is domain/auth-specific.`,
          state
        );
      } else {
        console.warn(
          `[NetProbe][HTTP_${response.status}] Neutral API returned non-OK status (${state.durationMs}ms).`,
          state
        );
      }
    } catch (err) {
      state.durationMs = Math.round(performance.now() - startedAt);
      state.completedAtIso = new Date().toISOString();
      state.ok = false;
      state.error = err instanceof Error ? err.message : String(err);
      state.diagnosis = 'NEUTRAL_API_BLOCKED_OR_OFFLINE';

      console.warn(
        `[NetProbe][BLOCKED] Neutral public API fetch failed (${state.durationMs}ms): ${state.error}`,
        state
      );
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }

    return state;
  })();

  return activeProbePromise;
}

export function getNeutralNetworkProbeResult(): NeutralNetworkProbeResult | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__ASHEN_NET_PROBE__ ?? null;
}
