import Anthropic from "@anthropic-ai/sdk";

export async function POST(request) {
  try {
    const { suburbs } = await request.json();
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Use web search to find CURRENT data from the internet (realestate.com.au, domain.com.au, conveyancing and law firm sites, industry bodies, news).

1) PROPERTY MARKET — Search for these suburbs: ${(suburbs || []).join(", ") || "Sydney, Melbourne"}.
   Find: median house/unit prices, recent price trends (%), days on market, auction clearance rates, any market commentary.
   Also search: Sydney and Melbourne overall market conditions, interest rate impact on property.

2) CONVEYANCING FEES — Search for current average conveyancing fees in Australia.
   Find: typical conveyancing fees NSW, typical conveyancing fees VIC, average cost of conveyancing 2024/2025, price ranges for purchase vs sale, what influences fees (property value, complexity). Use sources like Law Society, conveyancing comparison sites, recent articles.

Return valid JSON only (no markdown):
{
  "suburbs": [
    {
      "name": "suburb name",
      "state": "NSW/VIC",
      "medianPrice": "$X.XXM",
      "trend": "+X.X% YoY",
      "daysOnMarket": XX,
      "commentary": "brief market note"
    }
  ],
  "marketOverview": {
    "sydney": "current conditions summary from web",
    "melbourne": "current conditions summary from web",
    "interestRates": "current rate context",
    "outlook": "brief outlook"
  },
  "conveyancingFees": {
    "nsw": {
      "average": "$X,XXX or range",
      "range": "$X - $Y typical",
      "purchase": "typical fee for purchase",
      "sale": "typical fee for sale",
      "source": "brief source or date"
    },
    "vic": {
      "average": "$X,XXX or range",
      "range": "$X - $Y typical",
      "purchase": "typical fee for purchase",
      "sale": "typical fee for sale",
      "source": "brief source or date"
    },
    "commentary": "2-3 sentences on current market for conveyancing fees and what drives variation"
  }
}`,
        },
      ],
    });

    const textContent = (response.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    try {
      const clean = textContent.replace(/```json|```/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      return Response.json(parsed || { raw: textContent });
    } catch {
      return Response.json({ raw: textContent });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
