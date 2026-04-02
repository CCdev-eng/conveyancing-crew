import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";

// Anthropic's API request body limit is ~20MB total. Base64 encoding adds ~33% overhead,
// so a 10MB raw PDF chunk becomes ~13.4MB base64 — safely under the request limit.
const MAX_CHUNK_BYTES = 10 * 1024 * 1024;

export async function splitPdfIntoChunks(pdfBuffer) {
  const bytes =
    pdfBuffer instanceof ArrayBuffer ? new Uint8Array(pdfBuffer) : new Uint8Array(Buffer.from(pdfBuffer));
  const totalBytes = bytes.length;

  const pdfDoc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  const totalPages = pdfDoc.getPageCount();
  console.log(
    "[ReviewEngine] Total pages:", totalPages,
    "| File size:", Math.round(totalBytes / 1024 / 1024) + "MB"
  );

  // File fits in one chunk — send as-is
  if (totalBytes <= MAX_CHUNK_BYTES) {
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

  // Calculate pages per chunk from average page size, minimum 5 pages
  const avgBytesPerPage = totalBytes / totalPages;
  const pagesPerChunk = Math.max(5, Math.floor(MAX_CHUNK_BYTES / avgBytesPerPage));
  console.log(
    "[ReviewEngine] Avg page size:", Math.round(avgBytesPerPage / 1024) + "KB",
    "| Pages per chunk:", pagesPerChunk
  );

  const chunks = [];
  let startPage = 0;
  while (startPage < totalPages) {
    const endPage = Math.min(startPage + pagesPerChunk, totalPages);
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
    console.log(
      `[ReviewEngine] Chunk ${chunks.length}: pages ${startPage + 1}-${endPage}`,
      `(${Math.round(outBytes.length / 1024 / 1024 * 10) / 10}MB)`
    );
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
    // Keep well under Vercel's 300s function limit so a stalled call fails
    // cleanly with a clear error instead of a raw 504 from Vercel.
    timeout: 240 * 1000,
    defaultHeaders: {
      "anthropic-beta": "pdfs-2024-09-25",
    },
  });
}

/** Claude Opus 4 pricing (USD) + rough AUD conversion for client billing visibility */
const INPUT_COST_PER_MILLION = 15.0;
const OUTPUT_COST_PER_MILLION = 75.0;
const USD_TO_AUD = 1.55;

function buildReviewCost(totalUsage, pagesReviewed, chunksProcessed) {
  const inputCostUSD = (totalUsage.input_tokens / 1000000) * INPUT_COST_PER_MILLION;
  const outputCostUSD = (totalUsage.output_tokens / 1000000) * OUTPUT_COST_PER_MILLION;
  const totalCostUSD = inputCostUSD + outputCostUSD;
  const totalCostAUD = totalCostUSD * USD_TO_AUD;
  return {
    input_tokens: totalUsage.input_tokens,
    output_tokens: totalUsage.output_tokens,
    total_tokens: totalUsage.input_tokens + totalUsage.output_tokens,
    cost_usd: parseFloat(totalCostUSD.toFixed(4)),
    cost_aud: parseFloat(totalCostAUD.toFixed(4)),
    pages_reviewed: pagesReviewed,
    chunks_processed: chunksProcessed,
    model: "claude-opus-4-5",
    reviewed_at: new Date().toISOString(),
  };
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

settlementDate: The settlement date in DD/MM/YYYY format if a specific date is stated. If settlement is calculated from contract date (e.g. '42 days after contract'), write the formula as plain text but prefix with FORMULA: so it can be identified. If unknown write empty string.

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

  const usage = response.usage || {};
  const totalUsage = {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };
  console.log("[ReviewEngine] Docx review tokens:", totalUsage);

  const content = response.content?.[0]?.text || "{}";
  const parsed = parseJsonFromModelText(content);
  parsed._reviewCost = buildReviewCost(totalUsage, 0, 1);
  console.log("[ReviewEngine] Token usage:", totalUsage);
  console.log("[ReviewEngine] Cost USD:", parsed._reviewCost.cost_usd);
  console.log("[ReviewEngine] Cost AUD:", parsed._reviewCost.cost_aud);
  return parsed;
}

/**
 * Chunked PDF review (large documents).
 * @param {Buffer|ArrayBuffer} pdfBuffer
 * @param {string} matterContext
 */
export async function runContractReviewEngine(pdfBuffer, matterContext) {
  const client = getAnthropicClient();
  const chunks = await splitPdfIntoChunks(pdfBuffer);
  console.log("[ReviewEngine] Processing", chunks.length, "chunks");

  const chunkPromises = chunks.map(async (chunk, i) => {
    console.log(
      `[ReviewEngine] Starting chunk ${i + 1}/${chunks.length} (pages ${chunk.startPage}-${chunk.endPage})`
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

settlementDate: The settlement date in DD/MM/YYYY format if a specific date is stated. If settlement is calculated from contract date (e.g. '42 days after contract'), write the formula as plain text but prefix with FORMULA: so it can be identified. If unknown write empty string.

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

    const chunkUsage = {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    };

    const rawText = response.content?.[0]?.text || "{}";

    let chunkResult;
    try {
      chunkResult = parseJsonFromModelText(rawText);
    } catch (parseErr) {
      console.error(`[ReviewEngine] Chunk ${i + 1} parse failed:`, parseErr.message);
      return { index: i, result: null, usage: chunkUsage };
    }

    console.log(
      `[ReviewEngine] Chunk ${i + 1} done. Risk: ${chunkResult.overallRiskLevel} | Flags: ${chunkResult.redFlags?.length || 0} | Tokens:`, chunkUsage
    );
    return { index: i, result: chunkResult, usage: chunkUsage };
  });

  const outcomes = await Promise.all(chunkPromises);

  // Sort by original chunk index to preserve order
  outcomes.sort((a, b) => a.index - b.index);

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  const chunkResults = [];

  for (const outcome of outcomes) {
    totalUsage.input_tokens += outcome.usage.input_tokens;
    totalUsage.output_tokens += outcome.usage.output_tokens;
    if (outcome.result) chunkResults.push(outcome.result);
  }

  // Propagate key details from first chunk to any that didn't find them
  if (chunkResults.length > 1) {
    const first = chunkResults[0];
    for (const chunkResult of chunkResults.slice(1)) {
      if (!chunkResult.propertyAddress) chunkResult.propertyAddress = first.propertyAddress;
      if (!chunkResult.buyerName) chunkResult.buyerName = first.buyerName;
      if (!chunkResult.sellerName) chunkResult.sellerName = first.sellerName;
      if (!chunkResult.purchasePrice) chunkResult.purchasePrice = first.purchasePrice;
      if (!chunkResult.depositAmount) chunkResult.depositAmount = first.depositAmount;
      if (!chunkResult.settlementDate) chunkResult.settlementDate = first.settlementDate;
      if (!chunkResult.coolingOffPeriod) chunkResult.coolingOffPeriod = first.coolingOffPeriod;
    }
  }

  if (chunkResults.length === 0) {
    throw new Error("All chunks failed to process");
  }

  const merged = mergeChunkResults(chunkResults, chunks[0]?.totalPages || 0);

  const inputCostUSD = (totalUsage.input_tokens / 1000000) * INPUT_COST_PER_MILLION;
  const outputCostUSD = (totalUsage.output_tokens / 1000000) * OUTPUT_COST_PER_MILLION;
  const totalCostUSD = inputCostUSD + outputCostUSD;
  const totalCostAUD = totalCostUSD * USD_TO_AUD;

  console.log("[ReviewEngine] Token usage:", totalUsage);
  console.log("[ReviewEngine] Cost USD:", totalCostUSD.toFixed(4));
  console.log("[ReviewEngine] Cost AUD:", totalCostAUD.toFixed(4));

  merged._reviewCost = buildReviewCost(
    totalUsage,
    chunks[0]?.totalPages || 0,
    chunkResults.length
  );

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
