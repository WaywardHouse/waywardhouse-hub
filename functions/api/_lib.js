/**
 * Shared business logic for the WaywardHouse subscribe API.
 * Imported by subscribe.js / confirm.js / unsubscribe.js.
 * Underscore prefix = CF Pages will not expose this as a route.
 *
 * Env bindings required (set in CF Pages project settings):
 *   DB                 — D1 database  (wayward-house-subscribers)
 *   RESEND_API_KEY     — secret
 *   RESEND_AUDIENCE_ID — "20be979e-41b9-4d71-a327-b7f4a9fef027"
 *   SITE_URL           — "https://wayward.house"
 *   FROM_EMAIL         — "WaywardHouse <newsletter@wayward.house>"
 */

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX             = 5;
const TOKEN_EXPIRY_DAYS          = 7;

// ── Subscribe ─────────────────────────────────────────────────────────────────

export async function handleSubscribe(request, env) {
  const { email, source } = await parseBody(request);

  if (!email || !isValidEmail(email)) {
    return jsonResponse({ error: 'Please enter a valid email address.' }, 400, env);
  }

  const normalised = email.toLowerCase().trim();
  const ip         = request.headers.get('CF-Connecting-IP') || '';

  // Rate limit by IP
  const recentCount = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM subscribers
    WHERE ip = ? AND subscribed_at > datetime('now', ?)
  `).bind(ip, `-${RATE_LIMIT_WINDOW_SECONDS} seconds`).first();

  if (recentCount?.n >= RATE_LIMIT_MAX) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, env);
  }

  const existing = await env.DB.prepare(
    'SELECT id, confirmed, unsubscribed FROM subscribers WHERE email = ?'
  ).bind(normalised).first();

  if (existing?.confirmed && !existing?.unsubscribed) {
    return jsonResponse({ message: 'already_subscribed' }, 200, env);
  }

  const token = crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(`
      UPDATE subscribers
      SET token = ?, confirmed = 0, unsubscribed = 0,
          subscribed_at = datetime('now'), confirmed_at = NULL,
          unsubscribed_at = NULL, source = ?, ip = ?
      WHERE email = ?
    `).bind(token, source || 'unknown', ip, normalised).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO subscribers (email, token, source, ip) VALUES (?, ?, ?, ?)
    `).bind(normalised, token, source || 'unknown', ip).run();
  }

  const confirmUrl = `${env.SITE_URL}/api/confirm?token=${token}`;
  await sendConfirmationEmail(normalised, confirmUrl, env);

  return jsonResponse({ message: 'confirmation_sent' }, 200, env);
}

// ── Confirm ───────────────────────────────────────────────────────────────────

export async function handleConfirm(request, env) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return redirectTo(`${env.SITE_URL}/subscribe?error=invalid`);

  const subscriber = await env.DB.prepare(
    'SELECT id, email, confirmed, subscribed_at FROM subscribers WHERE token = ?'
  ).bind(token).first();

  if (!subscriber) return redirectTo(`${env.SITE_URL}/subscribe?error=invalid`);

  const subscribedAt = new Date(subscriber.subscribed_at + 'Z');
  const expiresAt    = new Date(subscribedAt.getTime() + TOKEN_EXPIRY_DAYS * 86400 * 1000);
  if (Date.now() > expiresAt.getTime()) {
    return redirectTo(`${env.SITE_URL}/subscribe?error=expired`);
  }

  if (!subscriber.confirmed) {
    await env.DB.prepare(`
      UPDATE subscribers SET confirmed = 1, confirmed_at = datetime('now') WHERE token = ?
    `).bind(token).run();

    await addToResendAudience(subscriber.email, env);
    await sendWelcomeEmail(subscriber.email, token, env);
  }

  return redirectTo(`${env.SITE_URL}/subscribed`);
}

// ── Unsubscribe ───────────────────────────────────────────────────────────────

export async function handleUnsubscribe(request, env) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return redirectTo(`${env.SITE_URL}/subscribe?error=invalid`);

  const subscriber = await env.DB.prepare(
    'SELECT id, email FROM subscribers WHERE token = ?'
  ).bind(token).first();

  if (subscriber) {
    await env.DB.prepare(`
      UPDATE subscribers
      SET unsubscribed = 1, unsubscribed_at = datetime('now')
      WHERE token = ?
    `).bind(token).run();

    await removeFromResendAudience(subscriber.email, env);
    await sendGoodbyeEmail(subscriber.email, env);
  }

  return redirectTo(`${env.SITE_URL}/unsubscribed`);
}

// ── Resend ────────────────────────────────────────────────────────────────────

async function sendConfirmationEmail(email, confirmUrl, env) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    env.FROM_EMAIL,
      to:      [email],
      subject: 'Confirm your Wayward House subscription',
      html:    confirmationEmailHtml(confirmUrl),
      text:    confirmationEmailText(confirmUrl),
    }),
  });
  if (!res.ok) console.error('Resend confirm error:', res.status, await res.text());
}

async function sendWelcomeEmail(email, token, env) {
  const unsubscribeUrl = `${env.SITE_URL}/api/unsubscribe?token=${token}`;
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    env.FROM_EMAIL,
      to:      [email],
      subject: 'Welcome to Wayward House',
      html:    welcomeEmailHtml(unsubscribeUrl),
      text:    welcomeEmailText(unsubscribeUrl),
    }),
  });
  if (!res.ok) console.error('Resend welcome error:', res.status, await res.text());
}

async function sendGoodbyeEmail(email, env) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    env.FROM_EMAIL,
      to:      [email],
      subject: "You've been unsubscribed from Wayward House",
      html:    goodbyeEmailHtml(`${env.SITE_URL}/subscribe`),
      text:    goodbyeEmailText(`${env.SITE_URL}/subscribe`),
    }),
  });
  if (!res.ok) console.error('Resend goodbye error:', res.status, await res.text());
}

async function addToResendAudience(email, env) {
  if (!env.RESEND_AUDIENCE_ID || env.RESEND_AUDIENCE_ID.startsWith('REPLACE')) return;
  const res = await fetch(
    `https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, unsubscribed: false }),
    }
  );
  if (!res.ok) console.error('Resend audience add error:', res.status, await res.text());
}

async function removeFromResendAudience(email, env) {
  if (!env.RESEND_AUDIENCE_ID || env.RESEND_AUDIENCE_ID.startsWith('REPLACE')) return;
  const listRes = await fetch(
    `https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`,
    { headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}` } }
  );
  if (!listRes.ok) return;
  const { data } = await listRes.json();
  const contact  = data?.find(c => c.email === email);
  if (!contact) return;
  await fetch(
    `https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts/${contact.id}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}` } }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export async function parseBody(request) {
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    return request.json().catch(() => ({}));
  }
  const fd = await request.formData().catch(() => new FormData());
  return { email: fd.get('email') || '', source: fd.get('source') || '' };
}

export function jsonResponse(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  env?.SITE_URL || '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin':  env?.SITE_URL || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function redirectTo(url) {
  return Response.redirect(url, 302);
}

// ── Email templates ───────────────────────────────────────────────────────────

function confirmationEmailHtml(confirmUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your subscription</title></head>
<body style="margin:0;padding:0;background:#f5f1ea;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ea;padding:40px 20px;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;width:100%;">
  <tr><td style="background:#0a0a0a;padding:24px 36px;border-bottom:3px solid #e02020;">
    <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.02em;font-family:'Arial Narrow',Arial,sans-serif;">WAYWARD<span style="color:#e02020;">·</span>HOUSE</span>
  </td></tr>
  <tr><td style="padding:36px 36px 28px;">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c1c1a;font-weight:700;">Confirm your subscription</h1>
    <p style="margin:0 0 10px;color:#5a5a56;line-height:1.65;font-size:15px;">You asked to subscribe to Wayward House. Confirm below and you'll receive:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#5a5a56;line-height:1.8;font-size:15px;">
      <li><strong style="color:#1c1c1a;">System Signals</strong> — a regular digest of the signals worth watching: Alberta economics, energy transition, trade geography, and the mechanics behind the numbers.</li>
      <li><strong style="color:#1c1c1a;">New essays</strong> — a note when long-form analysis publishes.</li>
    </ul>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr><td style="background:#e02020;">
        <a href="${confirmUrl}" style="display:inline-block;padding:13px 26px;background:#e02020;color:#fff;text-decoration:none;font-size:14px;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:0.02em;">
          Confirm my subscription →
        </a>
      </td></tr>
    </table>
    <p style="margin:0;color:#9a9a94;font-size:13px;line-height:1.5;">
      Or copy this link:<br>
      <span style="color:#5a5a56;word-break:break-all;font-family:'Courier New',monospace;font-size:12px;">${confirmUrl}</span>
    </p>
  </td></tr>
  <tr><td style="padding:20px 36px;border-top:1px solid #d0d0c8;">
    <p style="margin:0;color:#9a9a94;font-size:12px;line-height:1.5;">If you didn't subscribe to Wayward House, ignore this email. This link expires in 7 days.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function confirmationEmailText(confirmUrl) {
  return `Confirm your Wayward House subscription

You asked to subscribe. Click or paste the link below to confirm.

Once confirmed you'll receive:
- System Signals — a regular digest of Alberta economics, energy transition, trade geography, and the mechanics behind the numbers.
- New essays — a note when long-form analysis publishes.

Confirm here:
${confirmUrl}

This link expires in 7 days. If you didn't subscribe, ignore this email.

— Wayward House
`;
}

function welcomeEmailHtml(unsubscribeUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to Wayward House</title></head>
<body style="margin:0;padding:0;background:#f5f1ea;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ea;padding:32px 16px;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;">
  <tr><td style="background:#0a0a0a;padding:22px 36px;border-bottom:3px solid #e02020;">
    <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.02em;font-family:'Arial Narrow',Arial,sans-serif;">WAYWARD<span style="color:#e02020;">·</span>HOUSE</span>
  </td></tr>
  <tr><td style="padding:36px 36px 28px;">
    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#1c1c1a;font-weight:700;">You're in.</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#5a5a56;">Thanks for subscribing. Here's what to expect:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr><td style="padding:16px 20px;background:#f8f8f4;border-left:3px solid #e02020;">
        <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#1c1c1a;"><strong>System Signals</strong> — a regular digest of the signals worth watching: Alberta economics, energy transition, trade geography, and the stories behind the numbers.</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#1c1c1a;"><strong>New essays</strong> — longer analysis, a few times a month.</p>
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        <td style="padding-right:12px;">
          <table cellpadding="0" cellspacing="0"><tr><td style="background:#e02020;">
            <a href="https://wayward.house/essays/" style="display:inline-block;padding:11px 22px;background:#e02020;color:#fff;text-decoration:none;font-size:13px;font-weight:600;">Browse essays →</a>
          </td></tr></table>
        </td>
        <td>
          <table cellpadding="0" cellspacing="0"><tr><td style="border:1px solid #d0d0c8;">
            <a href="https://wayward.house/signals/" style="display:inline-block;padding:11px 22px;color:#5a5a56;text-decoration:none;font-size:13px;font-weight:600;">Read Signals →</a>
          </td></tr></table>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 36px;background:#f8f8f4;border-top:1px solid #d0d0c8;">
    <p style="margin:0 0 4px;font-size:12px;color:#9a9a94;">You subscribed at <a href="https://wayward.house" style="color:#9a9a94;">wayward.house</a>.</p>
    <p style="margin:0;font-size:12px;color:#9a9a94;"><a href="${unsubscribeUrl}" style="color:#9a9a94;text-decoration:underline;">Unsubscribe</a> · <a href="https://wayward.house/privacy/" style="color:#9a9a94;text-decoration:underline;">Privacy</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function welcomeEmailText(unsubscribeUrl) {
  return `Welcome to Wayward House

Thanks for subscribing. You'll receive:
- System Signals — Alberta economics, energy transition, trade geography.
- New essays — longer analysis, a few times a month.

Browse essays: https://wayward.house/essays/
Read Signals: https://wayward.house/signals/

—
Unsubscribe: ${unsubscribeUrl}
Privacy: https://wayward.house/privacy/
`;
}

function goodbyeEmailHtml(resubscribeUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
<body style="margin:0;padding:0;background:#f5f1ea;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ea;padding:32px 16px;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;">
  <tr><td style="background:#0a0a0a;padding:22px 36px;border-bottom:3px solid #e02020;">
    <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.02em;font-family:'Arial Narrow',Arial,sans-serif;">WAYWARD<span style="color:#e02020;">·</span>HOUSE</span>
  </td></tr>
  <tr><td style="padding:36px 36px 32px;">
    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#1c1c1a;font-weight:700;">You're unsubscribed.</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#5a5a56;">No more emails from Wayward House. No further action needed.</p>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#5a5a56;">If that was a mistake:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr><td style="border:1px solid #d0d0c8;">
        <a href="${resubscribeUrl}" style="display:inline-block;padding:11px 24px;color:#5a5a56;text-decoration:none;font-size:13px;font-weight:600;">Resubscribe</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;color:#9a9a94;">The site and archive remain open at <a href="https://wayward.house" style="color:#5a5a56;">wayward.house</a>.</p>
  </td></tr>
  <tr><td style="padding:20px 36px;background:#f8f8f4;border-top:1px solid #d0d0c8;">
    <p style="margin:0;font-size:12px;color:#9a9a94;"><a href="https://wayward.house/privacy/" style="color:#9a9a94;text-decoration:underline;">Privacy policy</a> · wayward.house</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function goodbyeEmailText(resubscribeUrl) {
  return `You've been unsubscribed from Wayward House.

No more emails. No further action needed.

Changed your mind? ${resubscribeUrl}

The site and archive remain open at https://wayward.house

— Wayward House
`;
}
