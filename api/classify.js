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
Classify this input and respond with ONLY a JSON object. No markdown, no code blocks, no extra text, just the raw JSON object.
Required fields:
- title: short clean version of the input (string)
- bucket: exactly one of: Work, Personal, Watch / Read, Creative, Health, Finance, Other
- priority: exactly one of: high, medium, low
- dueDate: ISO 8601 datetime string if time-sensitive (like "today 3pm", "tomorrow", "this friday"), otherwise null
- timeframe: exactly one of: Today, This week, This month, Someday, or null
- note: one short sentence tip, or null

Input to classify: ${text}

Respond with only the JSON object, starting with { and ending with }`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const raw = await r.text();
    if (!r.ok) return res.status(502).json({ error: 'Gemini failed', detail: raw });

    const data = JSON.parse(raw);
    const txt = data.candidates[0].content.parts[0].text;

    // Extract JSON from response - handle any wrapping
    const jsonMatch = txt.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'No JSON in response', raw: txt });

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
