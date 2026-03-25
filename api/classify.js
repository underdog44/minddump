export const config = { maxDuration: 30 };

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };

const WEEKDAYS = { sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,
  sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6 };

function parseDate(text) {
  const l = text.toLowerCase();
  const now = new Date();

  // Extract time if present e.g. "3pm", "11:45", "3:30 pm"
  let hours = null, mins = 0;
  const timeMatch = l.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    mins = parseInt(timeMatch[2] || '0');
    if (timeMatch[3] === 'pm' && hours < 12) hours += 12;
    if (timeMatch[3] === 'am' && hours === 12) hours = 0;
  } else {
    const t24 = l.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
    if (t24) { hours = parseInt(t24[1]); mins = parseInt(t24[2]); }
  }
  const defaultHour = hours !== null ? hours : 9;

  // "today"
  if (/\btoday\b|\btonight\b|\bnow\b|\burgent\b|\basap\b/.test(l)) {
    const d = new Date(now);
    d.setHours(hours !== null ? hours : 23, mins, 0, 0);
    return { dueDate: d.toISOString(), timeframe: null, priority: 'high' };
  }

  // "tomorrow"
  if (/\btomorrow\b/.test(l)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(defaultHour, mins, 0, 0);
    return { dueDate: d.toISOString(), timeframe: null, priority: 'high' };
  }

  // "next monday", "this friday", "by friday"
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    const re = new RegExp('(next\\s+|this\\s+|by\\s+)?' + name + '\\b');
    if (re.test(l)) {
      const d = new Date(now);
      let diff = dow - d.getDay();
      if (diff <= 0 || /next/.test(l)) diff += 7;
      d.setDate(d.getDate() + diff);
      d.setHours(defaultHour, mins, 0, 0);
      return { dueDate: d.toISOString(), timeframe: null, priority: 'high' };
    }
  }

  // "24th jan", "jan 24", "24 january", "january 24th"
  for (const [mname, mnum] of Object.entries(MONTHS)) {
    const re1 = new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+' + mname + '\\b');
    const re2 = new RegExp(mname + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b');
    const m1 = l.match(re1), m2 = l.match(re2);
    const day = m1 ? parseInt(m1[1]) : m2 ? parseInt(m2[1]) : null;
    if (day) {
      const d = new Date(now);
      d.setMonth(mnum, day);
      d.setHours(defaultHour, mins, 0, 0);
      if (d < now) d.setFullYear(d.getFullYear() + 1);
      return { dueDate: d.toISOString(), timeframe: null, priority: 'high' };
    }
  }

  // "DD/MM" or "MM/DD"
  const slashDate = l.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashDate) {
    const d = new Date(now);
    d.setMonth(parseInt(slashDate[2]) - 1, parseInt(slashDate[1]));
    d.setHours(defaultHour, mins, 0, 0);
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    return { dueDate: d.toISOString(), timeframe: null, priority: 'high' };
  }

  // Just a time mentioned with no date = today
  if (hours !== null) {
    const d = new Date(now);
    d.setHours(hours, mins, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1); // if time already passed, set tomorrow
    return { dueDate: d.toISOString(), timeframe: null, priority: 'high' };
  }

  // Vague timeframes
  if (/this week|next week|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(l))
    return { dueDate: null, timeframe: 'This week', priority: 'medium' };
  if (/this month|end of month|by end/.test(l))
    return { dueDate: null, timeframe: 'This month', priority: 'medium' };
  if (/next month/.test(l))
    return { dueDate: null, timeframe: 'This month', priority: 'low' };

  return { dueDate: null, timeframe: 'Someday', priority: 'low' };
}

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

  const l = text.toLowerCase();

  // Bucket detection
  let bucket = 'Other';
  if (/meeting|work|project|deadline|client|office|task|report|email|boss|colleague|bocw/.test(l)) bucket = 'Work';
  else if (/watch|movie|show|series|netflix|read|book|podcast|film|solaros|cinema/.test(l)) bucket = 'Watch / Read';
  else if (/gym|doctor|medicine|health|workout|diet|sleep|hospital|dentist/.test(l)) bucket = 'Health';
  else if (/idea|start|build|create|channel|design|art|music|write|launch/.test(l)) bucket = 'Creative';
  else if (/money|pay|bill|buy|order|shop|invest|bank|emi|purchase|expense/.test(l)) bucket = 'Finance';
  else if (/remind|pick|get|family|wife|kids|home|birthday|bday|personal|call|ramya/.test(l)) bucket = 'Personal';

  // Date/time parsing
  const { dueDate, timeframe, priority } = parseDate(text);

  // Clean title
  const title = text
    .replace(/remind me (to |about )?/i, '')
    .replace(/can you remind (me )?(by |on |at )?/i, '')
    .replace(/\s+/g, ' ').trim().slice(0, 100);

  // Try Gemini for smarter classification
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const now = new Date().toISOString();
    const prompt = 'Time: ' + now + '. Classify this note as JSON only (no markdown): {"title":string,"bucket":"Work|Personal|Watch / Read|Creative|Health|Finance|Other","priority":"high|medium|low","dueDate":"ISO datetime or null","timeframe":"Today|This week|This month|Someday|null","note":null}\nNote: ' + text;

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
          // Use our better date parsing if Gemini missed the date
          if (!parsed.dueDate && dueDate) parsed.dueDate = dueDate;
          if (!parsed.dueDate && !parsed.timeframe) parsed.timeframe = timeframe;
          if (!parsed.priority) parsed.priority = priority;
          return res.status(200).json(parsed);
        }
      }
    }
  } catch(e) { /* fall through to local */ }

  return res.status(200).json({ title, bucket, priority, dueDate, timeframe, note: null });
}
