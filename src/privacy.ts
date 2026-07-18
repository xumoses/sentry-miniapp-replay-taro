import type { Breadcrumb } from '@sentry/core';

const FILTERED = '[Filtered]';
const MAX_DEPTH = 8;
const SENSITIVE_KEY =
  /(?:^|[_-])(?:authorization|cookie|set-cookie|token|password|passwd|secret|api[_-]?key|apikey|session|openid|unionid|phone|email|idcard|identity|user|account|order|contract|body|headers)(?:$|[_-])/i;
const URL_KEY = /(?:^|[_-])(?:urls?|uris?|hrefs?|srcs?|action|from|to)(?:$|[_-])/i;

function normalizedKey(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function sanitizeUrl(value: string): string {
  if (/^data:/i.test(value)) {
    const mimeType = value.match(/^data:([^;,]+)/i)?.[1] || 'text/plain';
    return `data:${mimeType}`;
  }

  const withoutQueryOrFragment = value.split(/[?#]/, 1)[0] || '';
  return withoutQueryOrFragment.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)([^/?#@]+@)/i,
    '$1[filtered]:[filtered]@',
  );
}

function sanitizeValue(value: unknown, key: string, seen: WeakSet<object>, depth: number): unknown {
  const safeKey = normalizedKey(key);
  if (SENSITIVE_KEY.test(safeKey)) return FILTERED;
  if (typeof value === 'string') return URL_KEY.test(safeKey) ? sanitizeUrl(value) : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return FILTERED;
  if (seen.has(value)) return FILTERED;

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childValue, childKey, seen, depth + 1);
  }
  return result;
}

export function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value, '', new WeakSet(), 0) as Record<string, unknown>;
}

export function sanitizeBreadcrumb(
  breadcrumb: Breadcrumb,
  options: { maskMessage: boolean },
): Breadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message && options.maskMessage ? { message: FILTERED } : {}),
    ...(breadcrumb.data ? { data: sanitizeRecord(breadcrumb.data) } : {}),
  };
}
