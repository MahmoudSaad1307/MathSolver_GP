import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.refreshToken',
        '*.apiKey',
        '*.x-internal-key',
      ],
      censor: '[REDACTED]',
    },
    base: { service: 'mathlens-api' },
  });
}

export type Logger = ReturnType<typeof createLogger>;
