import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export async function taskRoutes(app: FastifyInstance) {
  // ------------- LISTAR TODAS AS TAREFAS --------------
  // OpenAPI: GET /tasks
  app.get('/tasks', { preHandler: app.auth }, async (req) => {
    const userId = (req.user as any).id as string;

    return prisma.task.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
  });

  // ------------- CRIAR TAREFA EM UMA LISTA ------------
  // OpenAPI: POST /lists/{listId}/tasks
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

    const position = await prisma.task.count({ where: { listId, userId } });

    const task = await prisma.task.create({
      data: {
        userId,
        listId,
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

  // ------------- LISTAR TAREFAS DE UMA LISTA ----------
  // OpenAPI: GET /lists/{listId}/tasks
  app.get('/lists/:listId/tasks', { preHandler: app.auth }, async (req) => {
    const { listId } = z.object({ listId: z.string().uuid() }).parse(req.params);
    const userId = (req.user as any).id as string;

    return prisma.task.findMany({
      where: { listId, userId },
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
  });

  // ------------- ATUALIZAR TAREFA ---------------------
  // OpenAPI: PATCH /tasks/{taskId}
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
        ...('dueDate' in body
          ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
          : {}),
        ...('position' in body ? { position: body.position } : {}),
      },
    });

    return updated;
  });

  // ------------- EXCLUIR TAREFA -----------------------
  // OpenAPI: DELETE /tasks/{taskId}
  app.delete('/tasks/:taskId', { preHandler: app.auth }, async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(req.params);
    const userId = (req.user as any).id as string;

    const exists = await prisma.task.findFirst({ where: { id: taskId, userId } });
    if (!exists) return reply.code(404).send({ message: 'Tarefa não encontrada' });

    await prisma.task.delete({ where: { id: taskId } });
    return reply.send({ ok: true });
  });

  // ------------- MOVER TAREFA -------------------------
  // OpenAPI: POST /tasks/{taskId}/move
  app.post('/tasks/:taskId/move', { preHandler: app.auth }, async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      targetListId: z.string().uuid(),
      // se null, joga pro fim da lista
      afterTaskId: z.string().uuid().nullable().optional(),
    }).parse(req.body);

    const userId = (req.user as any).id as string;

    const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
    if (!task) return reply.code(404).send({ message: 'Tarefa não encontrada' });

    const targetList = await prisma.list.findFirst({
      where: { id: body.targetListId, userId },
    });
    if (!targetList) {
      return reply.code(404).send({ message: 'Lista destino não encontrada' });
    }

    // calcula a nova posição na lista destino
    let newPosition: number;

    if (body.afterTaskId) {
      const afterTask = await prisma.task.findFirst({
        where: {
          id: body.afterTaskId,
          userId,
          listId: body.targetListId,
        },
      });

      if (!afterTask) {
        return reply.code(400).send({ message: 'afterTaskId inválido' });
      }

      newPosition = afterTask.position + 1;
    } else {
      // se não passar afterTaskId -> coloca no final
      const count = await prisma.task.count({
        where: { listId: body.targetListId, userId },
      });
      newPosition = count;
    }

    // normaliza as posições na lista destino (e troca a lista da tarefa)
    await prisma.$transaction(async (tx) => {
      // pega todas as tarefas da lista destino, exceto a que está sendo movida
      const tasksInTarget = await tx.task.findMany({
        where: {
          listId: body.targetListId,
          userId,
          NOT: { id: taskId },
        },
        orderBy: { position: 'asc' },
      });

      const updates: Promise<any>[] = [];

      let index = 0;
      for (const t of tasksInTarget) {
        if (index === newPosition) {
          // insere a tarefa movida aqui
          updates.push(
            tx.task.update({
              where: { id: taskId },
              data: { listId: body.targetListId, position: index },
            }),
          );
          index++;
        }
        updates.push(
          tx.task.update({
            where: { id: t.id },
            data: { position: index },
          }),
        );
        index++;
      }

      // se a nova posição for depois do último
      if (newPosition >= tasksInTarget.length) {
        updates.push(
          tx.task.update({
            where: { id: taskId },
            data: {
              listId: body.targetListId,
              position: tasksInTarget.length,
            },
          }),
        );
      }

      await Promise.all(updates);
    });

    return reply.send({ ok: true });
  });
}
