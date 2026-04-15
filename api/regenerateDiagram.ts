export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { prompt } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured on server' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${response.status}`, details: errText }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    
    // Extract and validate the SVG
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Clean up and validate the SVG
    let cleanSvg = rawText.trim();
    const match = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
    if (match) {
      cleanSvg = match[0];
    }
    
    if (!cleanSvg.includes('xmlns=')) {
      cleanSvg = cleanSvg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Add default dimensions if missing
    if (!cleanSvg.match(/\bwidth=/i)) {
      cleanSvg = cleanSvg.replace(/<svg/i, '<svg width="500"');
    }
    if (!cleanSvg.match(/\bheight=/i)) {
      cleanSvg = cleanSvg.replace(/<svg/i, '<svg height="400"');
    }

    return new Response(JSON.stringify({ svg: cleanSvg }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
