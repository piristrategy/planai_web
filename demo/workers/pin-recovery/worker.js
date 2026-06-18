/**
 * PlanAI Field — PIN recovery API (Cloudflare Worker).
 * Deploy: wrangler deploy; set secrets RESEND_API_KEY (optional), RECOVERY_SECRET.
 *
 * Endpoints:
 *   POST /v1/register  { email, emailHash, deviceId, mkBackup }
 *   POST /v1/otp/send  { email, deviceId }
 *   POST /v1/otp/verify { email, otp, deviceId } → { wrappedMk, wrapSalt }
 */
const OTP_TTL_MS = 10 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function deriveOtpWrapKey(otp, saltBytes) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(otp)), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function sendEmail(env, to, subject, text) {
  if (!env.RESEND_API_KEY) return { ok: false, dev: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RECOVERY_FROM || 'PlanAI Field <noreply@piristrategy.com>',
      to: [to],
      subject,
      text,
    }),
  });
  return { ok: res.ok };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    try {
      if (path === '/v1/register' && request.method === 'POST') {
        const body = await request.json();
        const email = normalizeEmail(body.email);
        const emailHash = body.emailHash || await sha256Hex(email);
        if (!email || !body.mkBackup) return json({ error: 'bad_request' }, 400);
        await env.RECOVERY_KV.put(`mk:${emailHash}`, JSON.stringify({
          mkBackup: body.mkBackup,
          deviceId: body.deviceId || null,
          updatedAt: Date.now(),
        }), { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true });
      }

      if (path === '/v1/otp/send' && request.method === 'POST') {
        const body = await request.json();
        const email = normalizeEmail(body.email);
        if (!email) return json({ error: 'bad_email' }, 400);
        const emailHash = await sha256Hex(email);
        const otp = randomOtp();
        await env.RECOVERY_KV.put(`otp:${emailHash}`, JSON.stringify({
          otp, exp: Date.now() + OTP_TTL_MS,
        }), { expirationTtl: 600 });
        const mail = await sendEmail(
          env, email,
          'PlanAI Field — PIN recovery code',
          `Your verification code: ${otp}\n\nValid for 10 minutes.`
        );
        return json({
          ok: true,
          hint: email.replace(/(.).+(@.+)/, '$1***$2'),
          devOtp: mail.dev ? otp : undefined,
        });
      }

      if (path === '/v1/otp/verify' && request.method === 'POST') {
        const body = await request.json();
        const email = normalizeEmail(body.email);
        const otp = String(body.otp || '').trim();
        if (!email || !otp) return json({ error: 'bad_input' }, 400);
        const emailHash = await sha256Hex(email);
        const otpRaw = await env.RECOVERY_KV.get(`otp:${emailHash}`);
        if (!otpRaw) return json({ error: 'otp_expired' }, 401);
        const otpData = JSON.parse(otpRaw);
        if (otpData.exp < Date.now() || otpData.otp !== otp) {
          return json({ error: 'otp_invalid' }, 401);
        }
        const mkRaw = await env.RECOVERY_KV.get(`mk:${emailHash}`);
        if (!mkRaw) return json({ error: 'no_backup' }, 404);
        const { mkBackup } = JSON.parse(mkRaw);
        const mkBytes = Uint8Array.from(atob(mkBackup), c => c.charCodeAt(0));
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveOtpWrapKey(otp, salt);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, mkBytes);
        const wrapped = new Uint8Array(iv.length + cipher.byteLength);
        wrapped.set(iv, 0);
        wrapped.set(new Uint8Array(cipher), iv.length);
        await env.RECOVERY_KV.delete(`otp:${emailHash}`);
        return json({ wrappedMk: b64(wrapped), wrapSalt: b64(salt) });
      }

      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'server_error' }, 500);
    }
  },
};
