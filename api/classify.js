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

  // Simple deterministic prompt - no special chars
  const prompt = [
    'Current time: ' + now,
    'Classify the input. Reply with ONLY raw JSON, no markdown.',
    'JSON fields: title(string), bucket(one of: Work|Personal|Watch / Read|Creative|Health|Finance|Other), priority(high|medium|low), dueDate(ISO string or null), timeframe(Today|This week|This month|Someday|null), note(string or null)',
    'Input: ' + text
  ].join('\n');

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 256, temperature: 0 }
        })
      }
    );

    // Read as text first for debugging
    const rawText = await r.text();

    if (!r.ok) {
      // Return full Gemini error
      return res.status(502).json({ error: 'Gemini error', detail: rawText.slice(0, 500) });
    }

    // Parse outer Gemini envelope
    let envelope;
    try {
      envelope = JSON.parse(rawText);
    } catch(e) {
      return res.status(500).json({ error: 'Bad envelope JSON', raw: rawText.slice(0, 300) });
    }

    // Extract the text content
    const content = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      return res.status(500).json({ error: 'No content in response', envelope: JSON.stringify(envelope).slice(0, 300) });
    }

    // Strip any markdown code fences
    const cleaned = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // Find JSON object
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'No JSON object found', content: cleaned.slice(0, 200) });
    }

    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    return res.status(200).json(parsed);

  } catch(e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 200) });
  }
}
