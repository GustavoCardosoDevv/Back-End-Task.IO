import 'dotenv/config';

function must(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  JWT_SECRET: must('JWT_SECRET', 'dev-secret'),
  CORS_ORIGINS: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  ACCESS_TTL: process.env.ACCESS_TTL ?? '15m',
  REFRESH_TTL: process.env.REFRESH_TTL ?? '30d',
};
