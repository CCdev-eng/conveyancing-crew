import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";

export async function splitPdfIntoChunks(pdfBuffer, chunkSize = 80) {
  const bytes =
    pdfBuffer instanceof ArrayBuffer ? new Uint8Array(pdfBuffer) : new Uint8Array(Buffer.from(pdfBuffer));
  const pdfDoc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  const totalPages = pdfDoc.getPageCount();
  console.log("[ReviewEngine] Total pages:", totalPages);
  if (totalPages <= chunkSize) {
    return [
      {
        base64: Buffer.from(bytes).toString("base64"),
        startPage: 1,
        endPage: totalPages,
        totalPages,
        isOnly: true,
      },
    ];
  }
  const chunks = [];
  let startPage = 0;
  while (startPage < totalPages) {
    const endPage = Math.min(startPage + chunkSize, totalPages);
    const chunkDoc = await PDFDocument.create();
    const indices = [];
    for (let i = startPage; i < endPage; i++) indices.push(i);
    const copiedPages = await chunkDoc.copyPages(pdfDoc, indices);
    copiedPages.forEach((p) => chunkDoc.addPage(p));
    const outBytes = await chunkDoc.save({ useObjectStreams: true });
    chunks.push({
      base64: Buffer.from(outBytes).toString("base64"),
      startPage: startPage + 1,
      endPage,
      totalPages,
      isOnly: false,
    });
    console.log(`[ReviewEngine] Chunk ${chunks.length}: pages ${startPage + 1}-${endPage}`);
    startPage = endPage;
  }
  return chunks;
}

export function mergeChunkResults(results, totalPages) {
  if (results.length === 1) return results[0];
  const merged = { ...results[0] };
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const statusOrder = { CRITICAL: 0, WARNING: 1, REVIEW: 2, OK: 3 };

  const seenFlags = new Set();
  merged.redFlags = results
    .flatMap((r) => r.redFlags || [])
    .filter((f) => {
      const key = (f.issue || "").slice(0, 60);
      if (seenFlags.has(key)) return false;
      seenFlags.add(key);
      return true;
    })
    .sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

  for (const level of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    if (results.some((r) => r.overallRiskLevel === level)) {
      merged.overallRiskLevel = level;
      break;
    }
  }

  const seenActions = new Set();
  merged.recommendedActions = results
    .flatMap((r) => r.recommendedActions || [])
    .filter((a) => {
      const key = (a.action || "").slice(0, 60);
      if (seenActions.has(key)) return false;
      seenActions.add(key);
      return true;
    });

  const seenNeg = new Set();
  merged.negotiationPoints = results
    .flatMap((r) => r.negotiationPoints || [])
    .filter((p) => {
      const key = (p || "").slice(0, 60);
      if (seenNeg.has(key)) return false;
      seenNeg.add(key);
      return true;
    });

  merged.sections = merged.sections || {};
  for (const key of Object.keys(merged.sections)) {
    const all = results.map((r) => r.sections?.[key]).filter(Boolean);
    if (all.length === 0) continue;
    all.sort((a, b) => (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9));
    const seenDetails = new Set();
    const seenConcerns = new Set();
    merged.sections[key] = {
      ...all[0],
      details: all
        .flatMap((s) => s.details || [])
        .filter((d) => {
          const k = String(d).slice(0, 60);
          if (seenDetails.has(k)) return false;
          seenDetails.add(k);
          return true;
        })
        .slice(0, 12),
      concerns: all
        .flatMap((s) => s.concerns || [])
        .filter((c) => {
          const k = String(c).slice(0, 60);
          if (seenConcerns.has(k)) return false;
          seenConcerns.add(k);
          return true;
        })
        .slice(0, 8),
    };
  }

  for (const result of results.slice(1)) {
    if (!merged.propertyAddress) merged.propertyAddress = result.propertyAddress;
    if (!merged.buyerName) merged.buyerName = result.buyerName;
    if (!merged.sellerName) merged.sellerName = result.sellerName;
    if (!merged.purchasePrice) merged.purchasePrice = result.purchasePrice;
    if (!merged.depositAmount) merged.depositAmount = result.depositAmount;
    if (!merged.settlementDate) merged.settlementDate = result.settlementDate;
    if (!merged.coolingOffPeriod) merged.coolingOffPeriod = result.coolingOffPeriod;
  }

  merged.overallSummary =
    `[${totalPages}-page contract reviewed across ${results.length} sections] ` + (merged.overallSummary || "");

  return merged;
}

function parseJsonFromModelText(rawText) {
  const clean = rawText.replace(/```json|```/g, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    let t = jsonMatch[0];
    let braces = 0;
    let brackets = 0;
    let inStr = false;
    let esc = false;
    for (const ch of t) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{") braces++;
      if (ch === "}") braces--;
      if (ch === "[") brackets++;
      if (ch === "]") brackets--;
    }
    if (inStr) t += '"';
    while (brackets > 0) {
      t += "]";
      brackets--;
    }
    while (braces > 0) {
      t += "}";
      braces--;
    }
    return JSON.parse(t);
  }
}

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: {
      "anthropic-beta": "pdfs-2024-09-25",
    },
  });
}

/**
 * Single-pass review for Word contracts (no PDF chunking).
 * @param {Buffer|ArrayBuffer} docxBuffer
 * @param {string} matterContext
 */
export async function runDocxContractReview(docxBuffer, matterContext) {
  const client = getAnthropicClient();
  const base64 = Buffer.from(docxBuffer).toString("base64");
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
              media_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  return parseJsonFromModelText(content);
}

/**
 * Chunked PDF review (large documents).
 * @param {Buffer|ArrayBuffer} pdfBuffer
 * @param {string} matterContext
 */
export async function runContractReviewEngine(pdfBuffer, matterContext) {
  const client = getAnthropicClient();
  const chunks = await splitPdfIntoChunks(pdfBuffer, 80);
  console.log("[ReviewEngine] Processing", chunks.length, "chunks");

  const chunkResults = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(
      `[ReviewEngine] Chunk ${i + 1}/${chunks.length} (pages ${chunk.startPage}-${chunk.endPage})`
    );

    const chunkNote =
      chunks.length > 1
        ? `\nNOTE: This is part ${i + 1} of ${chunks.length} of a ${chunk.totalPages}-page contract (pages ${chunk.startPage}-${chunk.endPage}).`
        : "";

    const clientLetterRule =
      i === 0
        ? "Write a complete 400-600 word plain-English letter to the client. Start with Dear [first name]. Sign off as Gitu Kaur, Conveyancing Crew."
        : 'Return an empty string "" for clientLetter (the first part already contains the full letter).';

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
                data: chunk.base64,
              },
            },
            {
              type: "text",
              text: `You are an expert Australian conveyancer reviewing a property contract.
${matterContext || ""}${chunkNote}

Review this contract thoroughly and return analysis as JSON.

Return ONLY this JSON (no markdown, no explanation outside JSON):

{
  "propertyAddress": "",
  "buyerName": "",
  "sellerName": "",
  "purchasePrice": "",
  "depositAmount": "",
  "settlementDate": "",
  "coolingOffPeriod": "",
  "overallRiskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
  "overallSummary": "2-3 sentence summary",
  "redFlags": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "area": "",
      "issue": "",
      "recommendation": "",
      "clauseReference": ""
    }
  ],
  "sections": {
    "contractTerms": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[]},
    "titleOwnership": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[],"easements":[],"covenants":[],"encumbrances":[]},
    "zoningPlanning": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[],"zoneType":"","overlays":[]},
    "councilCertificates": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[]},
    "specialConditions": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[],"financeClause":"","otherClauses":[]},
    "inclusionsExclusions": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","included":[],"excluded":[],"concerns":[]},
    "strataDetails": {"applicable":false,"status":"OK|REVIEW|WARNING|CRITICAL","levies":"","sinkingFund":"","specialLevies":"","concerns":[]},
    "adjustments": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[]},
    "disclosures": {"status":"OK|REVIEW|WARNING|CRITICAL","summary":"","details":[],"concerns":[]}
  },
  "clientLetter": "",
  "negotiationPoints": [],
  "recommendedActions": [{"priority":"URGENT|HIGH|MEDIUM|LOW","action":"","deadline":""}]
}

clientLetter rule: ${clientLetterRule}`,
            },
          ],
        },
      ],
    });

    const rawText = response.content?.[0]?.text || "{}";

    let chunkResult;
    try {
      chunkResult = parseJsonFromModelText(rawText);
    } catch (parseErr) {
      console.error(`[ReviewEngine] Chunk ${i + 1} parse failed:`, parseErr.message);
      continue;
    }

    if (i > 0 && chunkResults[0]) {
      const first = chunkResults[0];
      if (!chunkResult.propertyAddress) chunkResult.propertyAddress = first.propertyAddress;
      if (!chunkResult.buyerName) chunkResult.buyerName = first.buyerName;
      if (!chunkResult.sellerName) chunkResult.sellerName = first.sellerName;
      if (!chunkResult.purchasePrice) chunkResult.purchasePrice = first.purchasePrice;
      if (!chunkResult.depositAmount) chunkResult.depositAmount = first.depositAmount;
      if (!chunkResult.settlementDate) chunkResult.settlementDate = first.settlementDate;
      if (!chunkResult.coolingOffPeriod) chunkResult.coolingOffPeriod = first.coolingOffPeriod;
    }

    chunkResults.push(chunkResult);
    console.log(
      `[ReviewEngine] Chunk ${i + 1} done. Risk: ${chunkResult.overallRiskLevel} | Flags: ${chunkResult.redFlags?.length || 0}`
    );
  }

  if (chunkResults.length === 0) {
    throw new Error("All chunks failed to process");
  }

  const merged = mergeChunkResults(chunkResults, chunks[0]?.totalPages || 0);
  console.log(
    "[ReviewEngine] Complete. Risk:",
    merged.overallRiskLevel,
    "| Flags:",
    merged.redFlags?.length || 0,
    "| Chunks:",
    chunkResults.length
  );

  return merged;
}
