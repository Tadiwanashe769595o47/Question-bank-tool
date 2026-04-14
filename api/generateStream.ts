export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { prompt, diagramPreferences, systemInstruction, responseSchema } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured on server' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const parts: any[] = [{ text: prompt }];
    if (diagramPreferences?.referenceImage) {
      parts.push({
        inlineData: {
          data: diagramPreferences.referenceImage.data,
          mimeType: diagramPreferences.referenceImage.mimeType
        }
      });
    }

    const requestBody: any = {
      contents: [{ parts }],
    };

    if (systemInstruction) {
      requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (responseSchema) {
      requestBody.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: responseSchema
      };
    }

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${response.status}`, details: errText }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Stream the SSE response directly back to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
