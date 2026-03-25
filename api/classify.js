export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  // Determine bucket with simple rules first as fallback
  const l = text.toLowerCase();
  let bucket = 'Other';
  if (/meeting|work|project|deadline|client|office|task|report|email|boss|colleague/.test(l)) bucket = 'Work';
  else if (/watch|movie|show|series|netflix|read|book|podcast|film/.test(l)) bucket = 'Watch / Read';
  else if (/gym|doctor|medicine|health|workout|diet|sleep|hospital|dentist/.test(l)) bucket = 'Health';
  else if (/idea|start|build|create|channel|design|art|music|write|launch/.test(l)) bucket = 'Creative';
  else if (/money|pay|bill|buy|order|shop|invest|bank|emi|purchase|expense/.test(l)) bucket = 'Finance';
  else if (/remind|pick|get|family|wife|kids|home|birthday|bday|personal/.test(l)) bucket = 'Personal';

  let dueDate = null;
  let timeframe = 'Someday';
  let priority = 'low';
  if (/\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)/i.test(text)) {
    // Has a time - try to parse
    const d = new Date();
    const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      const m = parseInt(timeMatch[2] || '0');
      if (timeMatch[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
      if (timeMatch[3]?.toLowerCase() === 'am' && h === 12) h = 0;
      if (/tomorrow/i.test(text)) d.setDate(d.getDate() + 1);
      d.setHours(h, m, 0, 0);
      dueDate = d.toISOString();
      timeframe = null;
      priority = 'high';
    }
  } else if (/today|tonight|now|urgent|asap/i.test(l)) {
    const d = new Date(); d.setHours(23, 59, 0, 0);
    dueDate = d.toISOString(); timeframe = null; priority = 'high';
  } else if (/tomorrow/i.test(l)) {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    dueDate = d.toISOString(); timeframe = null; priority = 'medium';
  } else if (/this week|by friday|by monday/i.test(l)) {
    timeframe = 'This week'; priority = 'medium';
  } else if (/this month|end of month/i.test(l)) {
    timeframe = 'This month';
  }

  // Clean title
  const title = text.replace(/remind me (to |about )?/i, '').replace(/\s+/g, ' ').trim().slice(0, 100);

  // Try Gemini for better classification, fall back to local if it fails
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const prompt = 'Classify this note. Reply with ONLY a JSON object, nothing else.\nNote: ' + text + '\nJSON schema: {"title":string,"bucket":"Work|Personal|Watch / Read|Creative|Health|Finance|Other","priority":"high|medium|low","dueDate":"ISO string or null","timeframe":"Today|This week|This month|Someday|null","note":null}';

    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0, responseMimeType: 'application/json' }
        })
      }
    );
    clearTimeout(timeout);

    if (r.ok) {
      const data = await r.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(raw.slice(s, e + 1));
        if (parsed.title && parsed.bucket) {
          return res.status(200).json(parsed);
        }
      }
    }
  } catch(e) {
    // Gemini failed - use local fallback below
  }

  // Local fallback always works
  return res.status(200).json({ title, bucket, priority, dueDate, timeframe, note: null });
}
