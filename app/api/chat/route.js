import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request) {
  try {
    const { messages, mattersContext, systemOverride, maxTokens } = await request.json();

    const defaultSystem = `You are an AI assistant for Conveyancing Crew, 
an Australian conveyancing practice operating in NSW and VIC. 
You help conveyancers manage their matters, identify risks, draft 
communications, and stay on top of their workload.

Here is the current matters data for context:
${mattersContext}

Be concise, practical and professional. When asked about specific 
matters, reference the actual data provided. Always consider Australian 
conveyancing law and practice.

CRITICAL RESPONSE FORMAT RULES - always follow these without exception:
- Write in plain conversational English only
- Never use markdown symbols: no **, no ##, no ---, no *, no #
- For lists use simple numbered format: 1. item  2. item  3. item
- For emphasis just use normal sentence emphasis, not bold
- Keep responses concise - under 150 words unless more detail is asked for
- If tasks are due, list them as: 1. Task name (due date, urgency)
- Always end with one clear recommended next action`;

    const systemPrompt = systemOverride ?? defaultSystem;

    const parsedMax = Number.parseInt(String(maxTokens ?? ""), 10);
    const max_tokens = Number.isFinite(parsedMax)
      ? Math.min(Math.max(parsedMax, 1), 8192)
      : 600;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens,
      system: systemPrompt,
      messages: messages,
    });

    const content =
      (response.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") || "";
    return Response.json({ content: content || "" });

  } catch (error) {
    console.error("Claude API error - full error object:", error);
    return Response.json(
      { error: "Failed to get AI response" }, 
      { status: 500 }
    );
  }
}