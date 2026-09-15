import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from './logger';

/**
 * Transactional email. In development this points at Mailpit
 * (http://localhost:8025), so verification and reset links are inspectable
 * without sending anything to a real address.
 */

const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth:
    config.SMTP_USER && config.SMTP_PASS
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined,
});

interface Mail {
  to: string;
  subject: string;
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footer?: string;
}

/**
 * Send failures are logged, never thrown.
 *
 * A signup must not fail because an SMTP host is briefly down — the user's
 * account already exists at that point, and they can request a new link.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: config.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: toText(mail),
      html: toHtml(mail),
    });
    logger.info({ to: mail.to, subject: mail.subject }, 'email sent');
    return true;
  } catch (err) {
    logger.error({ err, to: mail.to, subject: mail.subject }, 'email delivery failed');
    return false;
  }
}

function toText(mail: Mail): string {
  const lines = [mail.heading, '', ...mail.body];
  if (mail.cta) lines.push('', `${mail.cta.label}: ${mail.cta.url}`);
  if (mail.footer) lines.push('', mail.footer);
  return lines.join('\n');
}

function toHtml(mail: Mail): string {
  const paragraphs = mail.body
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#334155">${escapeHtml(p)}</p>`)
    .join('');

  const cta = mail.cta
    ? `<p style="margin:24px 0">
         <a href="${escapeAttr(mail.cta.url)}"
            style="background:#0f172a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">
           ${escapeHtml(mail.cta.label)}
         </a>
       </p>
       <p style="margin:0 0 16px;font-size:13px;color:#64748b;word-break:break-all">
         Or paste this into your browser:<br>${escapeHtml(mail.cta.url)}
       </p>`
    : '';

  const footer = mail.footer
    ? `<p style="margin:24px 0 0;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px">${escapeHtml(mail.footer)}</p>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
    <div style="font-weight:700;font-size:18px;color:#0f172a;margin-bottom:24px">TradeOS</div>
    <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(mail.heading)}</h1>
    ${paragraphs}
    ${cta}
    ${footer}
  </div>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function sendVerificationEmail(to: string, name: string, token: string) {
  return sendMail({
    to,
    subject: 'Verify your TradeOS email',
    heading: `Welcome, ${name}`,
    body: [
      'Confirm this address to activate your TradeOS account and start connecting trading accounts.',
    ],
    cta: { label: 'Verify email', url: `${config.WEB_ORIGIN}/verify-email?token=${token}` },
    footer: 'This link expires in 24 hours. If you did not create an account, ignore this email.',
  });
}

export function sendPasswordResetEmail(to: string, name: string, token: string) {
  return sendMail({
    to,
    subject: 'Reset your TradeOS password',
    heading: `Password reset for ${name}`,
    body: ['We received a request to reset your password. Choose a new one using the link below.'],
    cta: { label: 'Reset password', url: `${config.WEB_ORIGIN}/reset-password?token=${token}` },
    footer:
      'This link expires in 60 minutes and can be used once. If you did not request a reset, ' +
      'your password is unchanged and no action is needed.',
  });
}

export function sendAccountDisconnectedEmail(to: string, accountName: string) {
  return sendMail({
    to,
    subject: `TradeOS: ${accountName} disconnected`,
    heading: 'A trading account went offline',
    body: [
      `TradeOS has lost contact with "${accountName}".`,
      'While it is offline no trades will be copied to or from this account. ' +
        'Check that MetaTrader is running and that the TradeOS agent is attached to a chart.',
    ],
    cta: { label: 'Open dashboard', url: `${config.WEB_ORIGIN}/accounts` },
  });
}

export function sendCopyFailedEmail(to: string, accountName: string, reason: string) {
  return sendMail({
    to,
    subject: `TradeOS: copy failed on ${accountName}`,
    heading: 'A trade could not be copied',
    body: [`TradeOS could not copy a master trade to "${accountName}".`, `Reason: ${reason}`],
    cta: { label: 'View copy log', url: `${config.WEB_ORIGIN}/copier` },
  });
}
