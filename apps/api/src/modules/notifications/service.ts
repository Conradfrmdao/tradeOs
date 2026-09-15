import type { NotificationSeverity, UserSettings } from '@tradeos/db';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { realtime } from '../../lib/realtime';
import { serializeNotification } from '../../lib/serialize';
import { sendMail } from '../../lib/mailer';
import { config } from '../../config';

/** Which per-user toggle governs whether this notification is also emailed. */
type EmailPreference =
  | 'notifyOnCopyOk'
  | 'notifyOnCopyFail'
  | 'notifyOnConnect'
  | 'notifyOnDisconnect'
  | 'always'
  | 'never';

export interface NotifyInput {
  type: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  emailPreference?: EmailPreference;
}

/**
 * Creates an in-dashboard notification, pushes it live, and optionally emails
 * it (PRD 29).
 *
 * Never throws: notifications are a side channel, and a failure here must not
 * roll back the trading action that triggered it.
 */
export async function notify(userId: string, input: NotifyInput): Promise<void> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type: input.type,
        severity: input.severity ?? 'INFO',
        title: input.title,
        body: input.body ?? null,
        meta: (input.meta ?? undefined) as never,
      },
    });

    realtime.publish(userId, {
      type: 'notification',
      data: serializeNotification(notification),
    });

    if (await shouldEmail(userId, input.emailPreference)) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerified: true },
      });

      // Never email an unverified address — we have no evidence the user owns it.
      if (user?.email && user.emailVerified) {
        const sent = await sendMail({
          to: user.email,
          subject: `TradeOS: ${input.title}`,
          heading: input.title,
          body: input.body ? [input.body] : ['See your dashboard for details.'],
          cta: { label: 'Open dashboard', url: `${config.WEB_ORIGIN}/dashboard` },
        });
        if (sent) {
          await prisma.notification.update({
            where: { id: notification.id },
            data: { emailedAt: new Date() },
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err, type: input.type, userId }, 'failed to create notification');
  }
}

async function shouldEmail(
  userId: string,
  preference: EmailPreference | undefined,
): Promise<boolean> {
  if (!preference || preference === 'never') return false;

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings?.notifyEmail) return false;
  if (preference === 'always') return true;

  return Boolean(settings[preference as keyof UserSettings]);
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}
