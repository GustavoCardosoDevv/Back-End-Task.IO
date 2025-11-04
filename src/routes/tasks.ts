import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export async function taskRoutes(app: FastifyInstance) {
  app.post('/lists/:listId/tasks', { preHandler: app.auth }, async (req, reply) => {
    const { listId } = z.object({ listId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.number().min(1).max(5).optional(),
      tags: z.array(z.string()).optional(),
      dueDate: z.string().datetime().optional(),
    }).parse(req.body);

    const userId = (req.user as any).id as string;
    const list = await prisma.list.findFirst({ where: { id: listId, userId } });
    if (!list) return reply.code(404).send({ message: 'Lista não encontrada' });

    const position = await prisma.task.count({ where: { listId } });

    const task = await prisma.task.create({
      data: {
        userId, listId,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority ?? 3,
        tags: (body.tags ?? []).join(','),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        position,
      },
    });

    return reply.code(201).send(task);
  });

  app.get('/lists/:listId/tasks', { preHandler: app.auth }, async (req) => {
    const { listId } = z.object({ listId: z.string().uuid() }).parse(req.params);
    const userId = (req.user as any).id as string;

    return prisma.task.findMany({
      where: { listId, userId },
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
  });

  app.patch('/tasks/:taskId', { preHandler: app.auth }, async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      status: z.enum(['todo', 'doing', 'done']).optional(),
      priority: z.number().min(1).max(5).optional(),
      tags: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      position: z.number().int().optional(),
    }).parse(req.body);

    const userId = (req.user as any).id as string;

    const exists = await prisma.task.findFirst({ where: { id: taskId, userId } });
    if (!exists) return reply.code(404).send({ message: 'Tarefa não encontrada' });

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...('title' in body ? { title: body.title } : {}),
        ...('description' in body ? { description: body.description ?? null } : {}),
        ...('status' in body ? { status: body.status } : {}),
        ...('priority' in body ? { priority: body.priority } : {}),
        ...('tags' in body ? { tags: (body.tags ?? []).join(',') } : {}),
        ...('dueDate' in body ? { dueDate: body.dueDate ? new Date(body.dueDate) : null } : {}),
        ...('position' in body ? { position: body.position } : {}),
      },
    });

    return updated;
  });

  app.delete('/tasks/:taskId', { preHandler: app.auth }, async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(req.params);
    const userId = (req.user as any).id as string;

    const exists = await prisma.task.findFirst({ where: { id: taskId, userId } });
    if (!exists) return reply.code(404).send({ message: 'Tarefa não encontrada' });

    await prisma.task.delete({ where: { id: taskId } });
    return reply.send({ ok: true });
  });
}
