const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4176',
  'http://127.0.0.1:4176',
  'https://timcash.github.io',
  'https://linker.dialtone.earth'
];

export function isAllowedOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  try {
    const normalizedOrigin = new URL(origin).origin;
    return getAllowedOrigins().has(normalizedOrigin);
  } catch {
    return false;
  }
}

export function appendCorsHeaders(headers: Record<string, string>, origin: string | undefined) {
  if (!origin || !isAllowedOrigin(origin)) {
    return headers;
  }

  return {
    ...headers,
    'Access-Control-Allow-Origin': new URL(origin).origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

function getAllowedOrigins() {
  const configuredOrigins = process.env.CODEX_ALLOWED_ORIGINS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS);
}
