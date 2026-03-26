// Cron job: fires every 5 minutes, sends due push notifications via web-push
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!vapidPublic || !vapidPrivate) {
    return res.status(200).json({ ok: false, msg: 'VAPID keys not set. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to Vercel env vars. Generate with: npx web-push generate-vapid-keys' });
  }
  if (!kvUrl || !kvToken) {
    return res.status(200).json({ ok: false, msg: 'KV not set. Add KV_REST_API_URL and KV_REST_API_TOKEN (create a Vercel KV store in your dashboard).' });
  }

  try {
    // List all subscription keys
    const listR = await fetch(`${kvUrl}/keys/sub_*`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const listD = await listR.json();
    const keys = listD.result || [];

    const now = new Date();
    const windowMs = 5 * 60 * 1000;
    let sent = 0;

    for (const key of keys) {
      try {
        const getR = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        const getD = await getR.json();
        if (!getD.result) continue;

        const { subscription, reminders } = JSON.parse(getD.result);
        if (!subscription || !reminders?.length) continue;

        for (const reminder of reminders) {
          if (!reminder.dueDate || reminder.status !== 'active') continue;
          const due = new Date(reminder.dueDate);
          const diff = due - now;

          // Main reminder: within ±5 min window
          if (diff >= -windowMs && diff <= windowMs) {
            await sendWebPush(subscription, {
              title: 'MindDump',
              body: reminder.title,
              tag: reminder.id,
              data: { id: reminder.id }
            }, vapidPublic, vapidPrivate);
            sent++;
          }

          // 15-min pre-alert
          if (diff >= 14 * 60 * 1000 && diff <= 16 * 60 * 1000) {
            await sendWebPush(subscription, {
              title: 'MindDump — in 15 min',
              body: reminder.title,
              tag: reminder.id + '-pre',
              data: { id: reminder.id }
            }, vapidPublic, vapidPrivate);
          }
        }
      } catch (e) {
        console.error('Key error', key, e.message);
      }
    }

    return res.status(200).json({ ok: true, sent, keys: keys.length, time: now.toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function sendWebPush(subscription, payload, vapidPublic, vapidPrivate) {
  // Use the web-push npm package approach via dynamic import
  // Since we can't install npm packages in serverless without package.json,
  // we use a minimal VAPID JWT implementation
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return;

  try {
    const jwt = await makeVapidJWT(endpoint, vapidPublic, vapidPrivate);
    const encrypted = await encryptPayload(JSON.stringify(payload), keys.p256dh, keys.auth);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt},k=${vapidPublic}`,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
      },
      body: encrypted
    });

    if (!response.ok && response.status !== 201) {
      console.error('Push failed:', response.status, await response.text().catch(()=>''));
    }
  } catch (e) {
    console.error('sendWebPush error:', e.message);
  }
}

async function makeVapidJWT(endpoint, publicKey, privateKeyB64) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: audience, exp: now + 43200, sub: 'mailto:push@minddump.app' }));
  const unsigned = `${header}.${claims}`;

  // Import private key
  const rawKey = base64urlToBuffer(privateKeyB64);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', rawKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${bufToB64url(sig)}`;
}

async function encryptPayload(payload, p256dhB64, authB64) {
  const p256dh = base64urlToBuffer(p256dhB64);
  const auth = base64urlToBuffer(authB64);

  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublicRaw = await crypto.subtle.exportKey('raw', serverKeys.publicKey);

  const receiverKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, serverKeys.privateKey, 256);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF to derive content encryption key
  const prk = await hkdf(sharedBits, auth, concat(new TextEncoder().encode('WebPush: info\x00'), p256dh, serverPublicRaw), 32);
  const contentKey = await crypto.subtle.importKey('raw', prk, { name: 'AES-GCM' }, false, ['encrypt']);

  const nonce = await hkdf(sharedBits, auth, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, contentKey, new TextEncoder().encode(payload));

  // Build aes128gcm header
  const recordSize = new Uint8Array(4); new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const keyIdLen = new Uint8Array([serverPublicRaw.byteLength]);
  return concat(salt, recordSize, keyIdLen, serverPublicRaw, encrypted);
}

async function hkdf(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

function b64url(str) { return btoa(str).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function bufToB64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function base64urlToBuffer(b64) {
  const p = b64.replace(/-/g,'+').replace(/_/g,'/');
  const b = atob(p);
  const r = new Uint8Array(b.length);
  for(let i=0;i<b.length;i++) r[i]=b.charCodeAt(i);
  return r.buffer;
}
function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + (a.byteLength || a.length), 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { const a = new Uint8Array(arr); out.set(a, offset); offset += a.length; }
  return out;
}
