export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key configured' });

  const now = new Date().toISOString();
  const prompt = `You are a personal assistant. Current time: ${now}.
Respond with ONLY valid JSON, no markdown, no backticks:
{"title":"...","bucket":"Work|Personal|Watch / Read|Creative|Health|Finance|Other","priority":"high|medium|low","dueDate":"ISO string or null","timeframe":"Today|This week|This month|Someday|null","note":"..."}
Parse natural time like "today 3pm", "tomorrow", "this friday" into exact ISO datetimes.
Input: ${text}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 200, temperature: 0.1 } })
      }
    );
    const raw = await r.text();
    if (!r.ok) return res.status(502).json({ error: 'Gemini failed', detail: raw });
    const data = JSON.parse(raw);
    const txt = data.candidates[0].content.parts[0].text.replace(/```json|```/g,'').trim();
    return res.status(200).json(JSON.parse(txt));
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
