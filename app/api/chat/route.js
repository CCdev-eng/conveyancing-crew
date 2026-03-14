import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request) {
  try {
    const { messages, mattersContext } = await request.json();

    const systemPrompt = `You are an AI assistant for Conveyancing Crew, 
an Australian conveyancing practice operating in NSW and VIC. 
You help conveyancers manage their matters, identify risks, draft 
communications, and stay on top of their workload.

Here is the current matters data for context:
${mattersContext}

Be concise, practical and professional. When asked about specific 
matters, reference the actual data provided. Format responses clearly 
with bullet points where appropriate. Always consider Australian 
conveyancing law and practice.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    return Response.json({ 
      content: response.content[0].text 
    });

  } catch (error) {
    console.error("Claude API error - full error object:", error);
    return Response.json(
      { error: "Failed to get AI response" }, 
      { status: 500 }
    );
  }
}