import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export async function listRoutes(app: FastifyInstance) {
  app.post('/lists', { preHandler: app.auth }, async (req, reply) => {
    const { title } = z.object({ title: z.string().min(1) }).parse(req.body);
    const userId = (req.user as any).id as string;

    const position = await prisma.list.count({ where: { userId } });
    const list = await prisma.list.create({ data: { title, userId, position } });
    return reply.code(201).send(list);
  });

  app.get('/lists', { preHandler: app.auth }, async (req) => {
    const userId = (req.user as any).id as string;
    return prisma.list.findMany({ where: { userId }, orderBy: { position: 'asc' } });
  });

  app.patch('/lists/:id', { preHandler: app.auth }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body   = z.object({ title: z.string().min(1) }).parse(req.body);
    const userId = (req.user as any).id as string;

    const list = await prisma.list.findFirst({ where: { id: params.id, userId } });
    if (!list) return reply.code(404).send({ message: 'Lista não encontrada' });

    return prisma.list.update({ where: { id: params.id }, data: { title: body.title } });
  });

  app.delete('/lists/:id', { preHandler: app.auth }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = (req.user as any).id as string;

    const list = await prisma.list.findFirst({ where: { id, userId } });
    if (!list) return reply.code(404).send({ message: 'Lista não encontrada' });

    await prisma.task.deleteMany({ where: { listId: id } });
    await prisma.list.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}
