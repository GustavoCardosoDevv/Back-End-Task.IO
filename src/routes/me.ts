import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: app.auth }, async (req) => {
    const userId = (req.user as any).id as string;
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, createdAt: true },
    });
  });
}
