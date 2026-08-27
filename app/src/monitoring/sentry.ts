import * as Sentry from '@sentry/react';
import { Platform } from 'react-native';

const SENTRY_DSN =
  'https://1e377fa3e0d8ccc3c8a40e0e06a4c605@o4511946612998144.ingest.us.sentry.io/4511946617454597';

let initialized = false;
const reportedTimings = new Set<string>();

function withoutQueryOrFragment(url?: string) {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

/**
 * Starts error reporting without collecting player identity, request bodies,
 * authentication data, click trails, console breadcrumbs, or session replay.
 */
export function initializeErrorMonitoring() {
  if (initialized || Platform.OS !== 'web' || typeof window === 'undefined') return;

  const isProduction = window.location.hostname === 'juwa.praksh-dhakal.workers.dev';

  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: isProduction,
    environment: isProduction ? 'production' : 'development',
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    enableLogs: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    integrations(defaultIntegrations) {
      return defaultIntegrations.filter(
        (integration) => integration.name !== 'Breadcrumbs' && integration.name !== 'BrowserSession',
      );
    },
    beforeSend(event) {
      // The browser/device context and JavaScript stack are useful for finding
      // the blackout. Account, request, and free-form app data are not needed.
      delete event.user;
      delete event.extra;

      if (event.request) {
        event.request.url = withoutQueryOrFragment(event.request.url);
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.env;
        delete event.request.headers;
        delete event.request.query_string;
      }

      return event;
    },
  });

  initialized = true;
}

export function reportReactCrash(error: Error, diagnosticId: string, componentStack?: string) {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    scope.setTag('juwa.recovery_code', diagnosticId);
    scope.setContext('react', {
      componentStack: componentStack || 'Unavailable',
    });
    Sentry.captureException(error);
  });
}

/**
 * Reports a slow or recovered game operation without attaching player data.
 *
 * One event per game/stage per page load is enough to diagnose a pattern and
 * avoids turning a bad connection into hundreds of duplicate Sentry events.
 */
export function reportGameTiming(
  stage: 'bet-response' | 'reel-landing-recovered',
  gameId: string,
  durationMs: number,
) {
  if (!initialized) return;

  const key = `${stage}:${gameId}`;
  if (reportedTimings.has(key)) return;
  reportedTimings.add(key);

  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setTag('juwa.game', gameId);
    scope.setTag('juwa.timing_stage', stage);
    scope.setContext('timing', { durationMs: Math.round(durationMs) });
    Sentry.captureMessage('Slow game operation recovered');
  });
}
