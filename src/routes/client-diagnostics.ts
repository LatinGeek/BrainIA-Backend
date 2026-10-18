import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { storeClientDiagnostics } from '../storage/client-diagnostic-repository.js';
import { ownerScope } from '../auth.js';

const diagnosticSchema = z.object({
  id: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(40),
  component: z.string().trim().min(1).max(80),
  level: z.enum(['debug', 'info', 'warning', 'error']),
  event: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime({ offset: true }),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

const batchSchema = z.object({
  logs: z.array(diagnosticSchema).min(1).max(50),
});

export const registerClientDiagnosticRoutes: FastifyPluginAsync = async (app) => {
  app.post('/client-diagnostics', async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_client_diagnostics', issues: parsed.error.flatten() });
    const clientId = ownerScope(request) ?? null;
    const accepted = await storeClientDiagnostics(parsed.data.logs.map((item) => ({ ...item, clientId })));
    return reply.status(202).send({ accepted, received: parsed.data.logs.length });
  });
};
