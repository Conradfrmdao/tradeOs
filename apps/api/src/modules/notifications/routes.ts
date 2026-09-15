import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireUser } from '../../plugins/auth';
import { serializeNotification } from '../../lib/serialize';
import { serializeUserSettings } from '../../lib/serialize';
import { markNotificationsRead } from './service';

const preferencesSchema = z.object({
  notifyEmail: z.boolean().optional(),
  notifyOnCopyOk: z.boolean().optional(),
  notifyOnCopyFail: z.boolean().optional(),
  notifyOnConnect: z.boolean().optional(),
  notifyOnDisconnect: z.boolean().optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/notifications', async (request, reply) => {
    const user = requireUser(request);

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return reply.send({ items: items.map(serializeNotification), unread });
  });

  app.post('/notifications/read', async (request, reply) => {
    const user = requireUser(request);
    const body = z.object({ ids: z.array(z.string().uuid()).optional() }).parse(request.body ?? {});
    const count = await markNotificationsRead(user.id, body.ids);
    return reply.send({ ok: true, count });
  });

  app.patch('/notifications/preferences', async (request, reply) => {
    const user = requireUser(request);
    const body = preferencesSchema.parse(request.body);

    const settings = await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...body },
      update: body,
    });

    return reply.send({ settings: serializeUserSettings(settings) });
  });
}
