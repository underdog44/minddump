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
  // Sanitize input - remove apostrophes and quotes that break JSON
  const safeText = text.replace(/'/g, '').replace(/"/g, '');

  const prompt = 'Current time: ' + now + '\nClassify this note and return ONLY a JSON object (no markdown, no explanation).\nFields: title (string, no apostrophes), bucket (Work or Personal or Watch / Read or Creative or Health or Finance or Other), priority (high or medium or low), dueDate (ISO datetime string if time given else null), timeframe (Today or This week or This month or Someday or null), note (null).\nInput: ' + safeText;

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 512,
            temperature: 0,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const rawText = await r.text();
    if (!r.ok) return res.status(502).json({ error: 'Gemini error', detail: rawText.slice(0, 500) });

    let envelope;
    try { envelope = JSON.parse(rawText); }
    catch(e) { return res.status(500).json({ error: 'Bad envelope', raw: rawText.slice(0, 300) }); }

    const content = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return res.status(500).json({ error: 'No content', envelope: rawText.slice(0, 300) });

    // Find the JSON object in the response
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'No JSON found', content: content.slice(0, 200) });

    const parsed = JSON.parse(content.slice(start, end + 1));
    // Restore original title from input if needed
    if (!parsed.title || parsed.title.length < 2) parsed.title = text.slice(0, 80);
    return res.status(200).json(parsed);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
