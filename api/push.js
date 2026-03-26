export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Return VAPID public key for client subscription
  if (req.method === 'GET') {
    const action = req.query?.action;
    if (action === 'vapid') {
      const key = process.env.VAPID_PUBLIC_KEY;
      if (!key) return res.status(200).json({ publicKey: null, message: 'VAPID not configured' });
      return res.status(200).json({ publicKey: key });
    }

    // Get stored subscription
    const userId = req.query?.userId || 'default';
    const data = await kvGet(`sub_${userId}`);
    return res.status(200).json(data || null);
  }

  if (req.method === 'POST') {
    const { subscription, reminders, userId } = req.body || {};
    if (!subscription) return res.status(400).json({ error: 'No subscription' });
    
    const id = userId || 'default';
    const data = { subscription, reminders: reminders || [], updatedAt: new Date().toISOString() };
    await kvSet(`sub_${id}`, data);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  } catch (e) { return null; }
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch (e) { console.error('KV set error', e); }
}
