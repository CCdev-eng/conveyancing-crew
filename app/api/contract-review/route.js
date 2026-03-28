import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

export async function POST(request) {
  try {
    const { storagePath, matterContext } = await request.json();

    if (!storagePath) {
      return NextResponse.json({ error: "No storage path provided" }, { status: 400 });
    }

    console.log("[ContractReview API] Storage path:", storagePath);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error("[ContractReview API] Missing Supabase URL or key");
      return NextResponse.json(
        { error: "Server is not configured for storage" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: signedData, error: signedError } = await supabase.storage
      .from("matter-documents")
      .createSignedUrl(storagePath, 60);

    if (signedError || !signedData?.signedUrl) {
      console.error("[ContractReview API] Signed URL error:", signedError);
      return NextResponse.json(
        { error: "Could not access document in storage" },
        { status: 500 }
      );
    }

    console.log("[ContractReview API] Fetching PDF from storage...");

    const pdfRes = await fetch(signedData.signedUrl);
    if (!pdfRes.ok) {
      return NextResponse.json(
        { error: "Could not download PDF from storage" },
        { status: 500 }
      );
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    const base64 = Buffer.from(pdfBuffer).toString("base64");

    console.log(
      "[ContractReview API] PDF size:",
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
${matterContext || ""}

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
    console.log("[ContractReview API] Response length:", content.length);

    let parsed;
    try {
      const clean = content.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (truncateErr) {
        let truncated = jsonMatch[0];
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
        if (inString) truncated += '"';
        while (brackets > 0) {
          truncated += "]";
          brackets--;
        }
        while (braces > 0) {
          truncated += "}";
          braces--;
        }
        parsed = JSON.parse(truncated);
      }
    } catch (e) {
      console.error("[ContractReview API] Parse error:", e.message);
      console.error("[ContractReview API] Content preview:", content.slice(0, 300));
      return NextResponse.json(
        { error: "Failed to parse AI response: " + e.message },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[ContractReview API] Unhandled error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Contract review failed" },
      { status: 500 }
    );
  }
}
