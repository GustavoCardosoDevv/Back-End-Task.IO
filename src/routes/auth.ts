import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../env';

export async function authRoutes(app: FastifyInstance) {
  // ---------------- REGISTER ----------------
  app.post('/auth/register', async (req, reply) => {
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
    }).parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return reply.code(409).send({ message: 'E-mail já cadastrado' });

    const hash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: { name: body.name, email: body.email, password: hash },
      select: { id: true, email: true },
    });

    const accessToken  = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: env.ACCESS_TTL });
    const refreshToken = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: env.REFRESH_TTL });

    // decodifica o refresh p/ obter exp (em segundos)
    const decoded = app.jwt.decode(refreshToken) as { exp?: number } | null;
    if (!decoded?.exp) {
      return reply.code(500).send({ message: 'Falha ao calcular expiração do refresh' });
    }
    const expiresAt = new Date(decoded.exp * 1000);

    // apaga tokens antigos desse usuário (opcional)
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    // salva com expiresAt
    await prisma.refreshToken.create({
      data: { userId: user.id, token: refreshToken, expiresAt },
    });

    return reply.code(201).send({
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
    });
  });

  // ---------------- LOGIN ----------------
  app.post('/auth/login', async (req, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(6),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(401).send({ message: 'Credenciais inválidas' });

    const ok = await bcrypt.compare(body.password, user.password);
    if (!ok) return reply.code(401).send({ message: 'Credenciais inválidas' });

    const accessToken  = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: env.ACCESS_TTL });
    const refreshToken = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: env.REFRESH_TTL });

    const decoded = app.jwt.decode(refreshToken) as { exp?: number } | null;
    if (!decoded?.exp) {
      return reply.code(500).send({ message: 'Falha ao calcular expiração do refresh' });
    }
    const expiresAt = new Date(decoded.exp * 1000);

    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await prisma.refreshToken.create({
      data: { userId: user.id, token: refreshToken, expiresAt },
    });

    return reply.send({
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
    });
  });

  // ---------------- REFRESH ----------------
  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);

    // Se token é @unique, pode usar findUnique; se não, use findFirst:
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
      .catch(() => null) ?? await prisma.refreshToken.findFirst({ where: { token: refreshToken } });

    if (!stored) return reply.code(401).send({ message: 'Refresh inválido' });

    try {
      const payload = app.jwt.verify<{ id: string; email: string }>(refreshToken);
      const accessToken = app.jwt.sign(
        { id: payload.id, email: payload.email },
        { expiresIn: env.ACCESS_TTL }
      );
      return reply.send({ tokenType: 'Bearer', accessToken, expiresIn: 15 * 60 });
    } catch {
      return reply.code(401).send({ message: 'Refresh expirado' });
    }
  });

  // ---------------- LOGOUT ----------------
  app.post('/auth/logout', { preHandler: app.auth }, async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    return reply.send({ ok: true });
  });
}
