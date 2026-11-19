import { config } from '../config.js';

export async function sendEmail(to: string, subject: string, html: string) {
  if (!config.resendKey) {
    console.log(`\n[email:dev] To: ${to}\n  Subject: ${subject}\n  ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to, subject, html }),
  });
  if (!res.ok) console.error('[email] send failed', res.status, await res.text());
}

const layout = (title: string, body: string, cta?: { href: string; label: string }) => `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#0b0e11;color:#eaecef;border-radius:8px">
  <h2 style="color:#0071e3;margin-top:0">${config.brand}</h2>
  <h3>${title}</h3>
  <p>${body}</p>
  ${cta ? `<p><a href="${cta.href}" style="display:inline-block;background:#0071e3;color:#ffffff;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:bold">${cta.label}</a></p><p style="font-size:12px;color:#848e9c">Or open: ${cta.href}</p>` : ''}
  <p style="font-size:12px;color:#848e9c">If you didn't request this, you can ignore this email.</p>
</div>`;

export const emails = {
  verify: (to: string, token: string) => {
    const href = `${config.webUrl}/verify-email?token=${token}`;
    return sendEmail(to, 'Verify your email', layout('Confirm your email address', 'Click below to verify your email.', { href, label: 'Verify email' }));
  },
  reset: (to: string, token: string) => {
    const href = `${config.webUrl}/reset-password?token=${token}`;
    return sendEmail(to, 'Reset your password', layout('Password reset', 'This link expires in 1 hour.', { href, label: 'Reset password' }));
  },
  withdrawal: (to: string, token: string, summary: string) => {
    const href = `${config.webUrl}/wallet/confirm-withdrawal?token=${token}`;
    return sendEmail(to, 'Confirm your withdrawal', layout('Confirm withdrawal', `${summary}. This link expires in 30 minutes.`, { href, label: 'Confirm withdrawal' }));
  },
};
