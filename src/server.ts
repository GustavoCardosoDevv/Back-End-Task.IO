import Fastify from 'fastify';
import { env } from './env';
import { prisma } from './lib/prisma';

// rotas e jwt só entram depois que os plugins básicos subirem
import jwtPlugin from './plugins/jwt';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { listRoutes } from './routes/lists';
import { taskRoutes } from './routes/tasks';

async function bootstrap() {
  const app = Fastify({ logger: true });

  const helmetMod = await import('@fastify/helmet').catch(() => ({} as any));
  const corsMod   = await import('@fastify/cors').catch(() => ({} as any));
  const fastifyHelmet: any = (helmetMod as any).default ?? helmetMod;
  const fastifyCors: any   = (corsMod as any).default ?? corsMod;

  app.log.info(
    {
      helmetHasDefault: Boolean((helmetMod as any).default),
      corsHasDefault: Boolean((corsMod as any).default),
      types: {
        helmet: typeof fastifyHelmet,
        cors: typeof fastifyCors,
        jwt: typeof jwtPlugin,
      },
    },
    'plugin-load-check',
  );

  try {
    await app.register(fastifyHelmet);
    app.log.info('helmet OK');
  } catch (e) {
    app.log.error({ e }, 'helmet FAIL');
    throw e;
  }

  try {
    await app.register(fastifyCors, {
      origin: env.CORS_ORIGINS,
      credentials: true,
    });
    app.log.info('cors OK');
  } catch (e) {
    app.log.error({ e }, 'cors FAIL');
    throw e;
  }

  try {
    await app.register(jwtPlugin as any);
    app.log.info('jwtPlugin OK');
  } catch (e) {
    app.log.error({ e }, 'jwtPlugin FAIL');
    throw e;
  }

  // Health
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/health/db', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { db: 'ok' };
  });

  // Rotas com prefixo /api
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(meRoutes,   { prefix: '/api' });
  await app.register(listRoutes, { prefix: '/api' });
  await app.register(taskRoutes, { prefix: '/api' });

  // (Opcional) listar rotas no boot
  // console.log(app.printRoutes());

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`UP: http://localhost:${env.PORT}/api`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
