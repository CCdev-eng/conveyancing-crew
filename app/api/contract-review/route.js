import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const maxDuration = 120;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const matterContext = formData.get("matterContext") || "";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    console.log(
      "[ContractReview API] File size:",
      Math.round((base64.length * 0.75) / 1024),
      "KB"
    );

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[ContractReview API] ANTHROPIC_API_KEY is not set");
      return NextResponse.json(
        { error: "Server is not configured for contract review" },
        { status: 500 }
      );
    }

    const client = new Anthropic({
      apiKey,
      defaultHeaders: {
        "anthropic-beta": "pdfs-2024-09-25",
      },
    });

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: `You are an expert Australian conveyancer reviewing a property contract.
${matterContext}

Review this contract thoroughly across all 11 critical areas and return a 
complete analysis as JSON.

Return ONLY this JSON structure (no markdown, no explanation outside JSON):

{
  "propertyAddress": "",
  "buyerName": "",
  "sellerName": "",
  "purchasePrice": "",
  "depositAmount": "",
  "settlementDate": "",
  "coolingOffPeriod": "",
  "overallRiskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
  "overallSummary": "2-3 sentence plain English summary of the contract",
  "redFlags": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "area": "area name",
      "issue": "clear description of the issue",
      "recommendation": "what the conveyancer should do",
      "clauseReference": "clause number if found"
    }
  ],
  "sections": {
    "contractTerms": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": []
    },
    "titleOwnership": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": [],
      "easements": [],
      "covenants": [],
      "encumbrances": []
    },
    "zoningPlanning": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": [],
      "zoneType": "",
      "overlays": []
    },
    "councilCertificates": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": []
    },
    "specialConditions": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": [],
      "financeClause": "",
      "otherClauses": []
    },
    "inclusionsExclusions": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "included": [],
      "excluded": [],
      "concerns": []
    },
    "strataDetails": {
      "applicable": false,
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "levies": "",
      "sinkingFund": "",
      "specialLevies": "",
      "concerns": []
    },
    "adjustments": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": []
    },
    "disclosures": {
      "status": "OK|REVIEW|WARNING|CRITICAL",
      "summary": "",
      "details": [],
      "concerns": []
    }
  },
  "clientLetter": "A complete professional plain-English letter from the conveyancer to the client. Start with Dear [client first name]. Cover key terms, concerns, and next steps. Sign off as Gitu Kaur, Conveyancing Crew. Length 400-600 words.",
  "negotiationPoints": ["point 1", "point 2"],
  "recommendedActions": [
    {
      "priority": "URGENT|HIGH|MEDIUM|LOW",
      "action": "specific action",
      "deadline": "when"
    }
  ]
}`,
            },
          ],
        },
      ],
    });

    const content = response.content?.[0]?.text || "{}";

    let parsed;
    try {
      const clean = content.replace(/```json|```/g, "").trim();

      // First try normal parse
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");

      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (truncateErr) {
        // JSON was truncated — attempt to repair it
        console.log("[ContractReview API] JSON truncated, attempting repair...");

        let truncated = jsonMatch[0];

        // Count open braces/brackets to find how many we need to close
        let braces = 0;
        let brackets = 0;
        let inString = false;
        let escape = false;

        for (const ch of truncated) {
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === "\\") {
            escape = true;
            continue;
          }
          if (ch === '"' && !escape) {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (ch === "{") braces++;
          if (ch === "}") braces--;
          if (ch === "[") brackets++;
          if (ch === "]") brackets--;
        }

        // If we are inside a string value, close it first
        if (inString) truncated += '"';
        // Close any open arrays
        while (brackets > 0) {
          truncated += "]";
          brackets--;
        }
        // Close any open objects
        while (braces > 0) {
          truncated += "}";
          braces--;
        }

        console.log("[ContractReview API] Repaired JSON, attempting parse...");
        parsed = JSON.parse(truncated);
        console.log("[ContractReview API] Repair successful!");
      }
    } catch (e) {
      console.error("[ContractReview API] JSON parse failed:", e.message);
      console.error("[ContractReview API] Content length:", content.length);
      console.error("[ContractReview API] Content preview:", content.slice(0, 500));
      return NextResponse.json(
        {
          error: "Failed to parse AI response: " + e.message,
          rawContent: content.slice(0, 500),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[ContractReview API] Error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Contract review failed" },
      { status: 500 }
    );
  }
}
