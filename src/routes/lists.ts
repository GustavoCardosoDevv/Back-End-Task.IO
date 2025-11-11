import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export async function listRoutes(app: FastifyInstance) {
  // ----------------- LISTAR LISTAS -----------------
  app.get('/lists', { preHandler: app.auth }, async (req) => {
    const userId = (req.user as any).id as string;

    return prisma.list.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    });
  });

  // ----------------- CRIAR LISTA -------------------
  app.post('/lists', { preHandler: app.auth }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1),
    }).parse(req.body);

    const userId = (req.user as any).id as string;

    const position = await prisma.list.count({ where: { userId } });

    const list = await prisma.list.create({
      data: {
        userId,
        title: body.title,
        position,
      },
    });

    return reply.code(201).send(list);
  });

  // ----------------- ATUALIZAR LISTA ---------------
  app.patch('/lists/:listId', { preHandler: app.auth }, async (req, reply) => {
    const { listId } = z.object({ listId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      title: z.string().min(1),
    }).parse(req.body);

    const userId = (req.user as any).id as string;

    const exists = await prisma.list.findFirst({ where: { id: listId, userId } });
    if (!exists) return reply.code(404).send({ message: 'Lista não encontrada' });

    const updated = await prisma.list.update({
      where: { id: listId },
      data: { title: body.title },
    });

    return updated;
  });

  // ----------------- EXCLUIR LISTA -----------------
  app.delete('/lists/:listId', { preHandler: app.auth }, async (req, reply) => {
    const { listId } = z.object({ listId: z.string().uuid() }).parse(req.params);
    const userId = (req.user as any).id as string;

    const exists = await prisma.list.findFirst({ where: { id: listId, userId } });
    if (!exists) return reply.code(404).send({ message: 'Lista não encontrada' });

    // primeiro remove tarefas da lista
    await prisma.task.deleteMany({ where: { listId, userId } });
    await prisma.list.delete({ where: { id: listId } });

    return reply.code(204).send();
  });

  //Reordenar Listas
  app.post('/lists/reorder', { preHandler: app.auth }, async (req, reply) => {
    const body = z.object({
      sourceIndex: z.number().int().nonnegative(),
      targetIndex: z.number().int().nonnegative(),
    }).parse(req.body);

    const userId = (req.user as any).id as string;

    // pega as listas do usuário na ordem atual
    const lists = await prisma.list.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    });

    if (
      body.sourceIndex < 0 ||
      body.sourceIndex >= lists.length ||
      body.targetIndex < 0 ||
      body.targetIndex >= lists.length
    ) {
      return reply.code(400).send({ message: 'Índices inválidos para reordenar listas' });
    }

    // remove a lista da posição sourceIndex
    const [moved] = lists.splice(body.sourceIndex, 1);
    // insere na posição targetIndex
    lists.splice(body.targetIndex, 0, moved);

    // atualiza as posições no banco
    await prisma.$transaction(
      lists.map((list, index) =>
        prisma.list.update({
          where: { id: list.id },
          data: { position: index },
        }),
      ),
    );

    return reply.code(204).send();
  });
}