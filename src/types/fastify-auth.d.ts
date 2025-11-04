import type { FastifyReply, FastifyRequest } from 'fastify';
declare module 'fastify' {
  interface FastifyInstance {
    auth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: { id: string; email: string };
  }
}
