export default async function handler(req, res) {
  // Allow requests from your app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured on server' });

  const now = new Date().toISOString();
  const prompt = `You are a personal assistant that classifies thoughts, tasks, and reminders. Current time: ${now}.
Respond with ONLY valid JSON (no markdown, no backticks) with these fields:
- title: string (clean, concise version of the input)
- bucket: one of "Work", "Personal", "Watch / Read", "Creative", "Health", "Finance", "Other"
- priority: "high" | "medium" | "low"
- dueDate: ISO 8601 datetime string if time-sensitive, null otherwise. Parse natural language like "today at 3pm", "tomorrow morning", "this Friday", "next Monday 11am", "end of month" into exact ISO datetimes.
- timeframe: "Today" | "This week" | "This month" | "Someday" | null
- note: optional short tip (max 10 words)

User input: ${text}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.1 }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: 'Gemini error', detail: err });
    }

    const data = await response.json();
    const raw = data.candidates[0].content.parts[0].text
      .replace(/```json|```/g, '').trim();

    const parsed = JSON.parse(raw);
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: 'Classification failed', detail: e.message });
  }
}
