import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  runContractReviewEngine,
  runDocxContractReview,
} from "@/app/lib/contractReviewEngine";

/** 5 minutes max for the cron itself */
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const CONTRACTS_MAILBOX = "contractreview@conveyancingcrew.com.au";
const GITU_NOTIFY_EMAIL = "gitu@conveyancingcrew.com.au";

function isForwardedEmail(subject) {
  return /^(fwd?:|fw:)/i.test((subject || "").trim());
}

/** Exclude automated contract-review notifications we sent to Gitu from inbox search matches */
function filterOutOurReviewEmails(messages) {
  return (messages || []).filter((m) => {
    const subj = (m.subject || "").toLowerCase();
    return (
      !subj.startsWith("✦ contract review") &&
      !subj.startsWith("⚠ contract review") &&
      !subj.includes("contract review failed") &&
      !subj.includes("contract review issue") &&
      !subj.includes("could not find original") &&
      !subj.includes("no contract found") &&
      !subj.includes("review issue")
    );
  });
}

function detectStateFromAddress(addr) {
  const a = String(addr || "").toUpperCase();
  if (/\bNSW\b|NEW SOUTH WALES/.test(a)) return "NSW";
  if (/\bVIC\b|VICTORIA/.test(a)) return "VIC";
  if (/\bQLD\b|QUEENSLAND/.test(a)) return "QLD";
  if (/\bSA\b|SOUTH AUSTRALIA/.test(a)) return "SA";
  if (/\bWA\b|WESTERN AUSTRALIA/.test(a)) return "WA";
  if (/\bTAS\b|TASMANIA/.test(a)) return "TAS";
  if (/\bACT\b/.test(a)) return "ACT";
  const m = a.match(/\b(\d{4})\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if ((n >= 2000 && n <= 2599) || (n >= 2619 && n <= 2898)) return "NSW";
    if (n >= 3000 && n <= 3999) return "VIC";
    if (n >= 4000 && n <= 4999) return "QLD";
  }
  return "NSW";
}

function parsePurchasePriceInt(priceStr) {
  const d = String(priceStr || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : null;
}

/** DD/MM/YYYY → YYYY-MM-DD; formulas skipped */
function parseSettlementToIso(settlementStr) {
  const t = String(settlementStr || "").trim();
  if (!t || /^formula:/i.test(t)) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  return null;
}

function extractContractReviewFieldsForMatter(r) {
  const client_name = r?.buyerName || r?.purchaserName || null;
  const address = r?.propertyAddress || null;
  const purchase_price = r?.purchasePrice ?? null;
  const settlement_date = r?.settlementDate ?? null;
  const blob = JSON.stringify(r || {}).toLowerCase();
  const hasPurchaser = blob.includes("purchaser");
  const hasVendor = blob.includes("vendor");
  let matter_type = "Purchase";
  if (hasPurchaser) matter_type = "Purchase";
  else if (hasVendor) matter_type = "Sale";

  const state = detectStateFromAddress(address);
  return {
    client_name: client_name ? String(client_name).trim() || null : null,
    address: address ? String(address).trim() || null : null,
    purchase_price: purchase_price != null ? String(purchase_price).trim() || null : null,
    settlement_date: settlement_date != null ? String(settlement_date).trim() || null : null,
    matter_type,
    state,
  };
}

async function nextMatterRefContractCron(supabase, year) {
  const prefix = `CC-${year}-`;
  const { data: rows, error } = await supabase.from("matters").select("matter_ref");
  if (error) throw error;
  let maxN = 0;
  const re = new RegExp(`^CC-${year}-(\\d+)$`);
  for (const row of rows || []) {
    const id = String(row.matter_ref || "");
    const m = id.match(re);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${prefix}${String(maxN + 1).padStart(3, "0")}`;
}

/**
 * After a completed contract review is saved: link to existing matter by address or create draft matter.
 */
async function linkOrCreateMatterFromContractReview(supabase, reviewResult, inboxRowId, emailId) {
  try {
    const fields = extractContractReviewFieldsForMatter(reviewResult);
    const { client_name, address, purchase_price, settlement_date, matter_type, state } = fields;

    const draft_extracted = {
      source: "contract_review",
      contract_review_id: inboxRowId,
      client_name,
      address,
      purchase_price,
      settlement_date,
      matter_type,
      state,
    };

    const addrSearch = String(address || "").trim();
    let existingRef = null;

    if (addrSearch.length >= 6) {
      const term = addrSearch.replace(/%/g, "").replace(/_/g, "").slice(0, 120);
      const { data: hit, error: findErr } = await supabase
        .from("matters")
        .select("matter_ref")
        .ilike("address", `%${term}%`)
        .neq("matter_status", "closed")
        .limit(1)
        .maybeSingle();
      if (findErr) {
        console.error("[ContractInbox] existing matter lookup failed:", findErr);
      } else if (hit?.matter_ref) {
        existingRef = hit.matter_ref;
      }
    }

    if (existingRef) {
      await supabase.from("contract_review_inbox").update({ matter_ref: existingRef }).eq("id", inboxRowId);
      console.log("[ContractInbox] Linked review to existing matter:", existingRef);
      return;
    }

    const year = new Date().getFullYear();
    const matter_ref = await nextMatterRefContractCron(supabase, year);
    const opened_date = new Date().toISOString().slice(0, 10);
    const priceVal = parsePurchasePriceInt(purchase_price);
    const settlement_date_iso = parseSettlementToIso(settlement_date);

    const row = {
      matter_ref,
      client_name: client_name || null,
      address: addrSearch || null,
      price: priceVal,
      settlement_date: settlement_date_iso,
      type: matter_type,
      state: state || "NSW",
      matter_status: "draft",
      source_email_id: emailId,
      draft_extracted,
      opened_date,
      stage: "Intake",
      status: "active",
      urgency: "medium",
      staff: "contract-review-cron",
      notes: JSON.stringify({ source: "contract_review_cron" }),
    };

    let { error: insErr } = await supabase.from("matters").insert(row);
    if (insErr) {
      const { source_email_id: _s, draft_extracted: _d, matter_status: _m, ...fallback } = row;
      const r2 = await supabase.from("matters").insert(fallback);
      insErr = r2.error;
    }
    if (insErr) {
      console.error("[ContractInbox] matters insert from review failed:", insErr);
      return;
    }

    await supabase.from("contract_review_inbox").update({ matter_ref }).eq("id", inboxRowId);
    console.log("[ContractInbox] Draft matter created:", matter_ref, "from contract review");
  } catch (e) {
    console.error("[ContractInbox] linkOrCreateMatterFromContractReview:", e.message);
  }
}

async function markEmailRead(accessToken, emailId) {
  const graphUser = encodeURIComponent(CONTRACTS_MAILBOX);
  try {
    await fetch(`https://graph.microsoft.com/v1.0/users/${graphUser}/messages/${emailId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: true }),
    });
  } catch (err) {
    console.error("[ContractCron] Could not mark email as read:", err.message);
  }
}

async function sendReviewResultEmail(accessToken, email, documentName, r) {
  const graphUser = encodeURIComponent(CONTRACTS_MAILBOX);
  const riskColors = { LOW: "#16a34a", MEDIUM: "#ca8a04", HIGH: "#dc2626", CRITICAL: "#7f1d1d" };
  const riskBg = { LOW: "#f0fdf4", MEDIUM: "#fffbeb", HIGH: "#fef2f2", CRITICAL: "#fff1f2" };
  const riskEmoji = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴", CRITICAL: "🚨" };
  const risk = String(r.overallRiskLevel || "MEDIUM").toUpperCase();

  const statusColor = { OK: "#16a34a", REVIEW: "#245eb0", WARNING: "#ca8a04", CRITICAL: "#dc2626" };
  const statusBg = { OK: "#f0fdf4", REVIEW: "#e8f0fb", WARNING: "#fffbeb", CRITICAL: "#fef2f2" };
  const statusLabel = {
    OK: "✓ OK",
    REVIEW: "👁 Review",
    WARNING: "⚠ Warning",
    CRITICAL: "🚨 Critical",
  };

  const sectionIcon = {
    contractTerms: "📋",
    titleOwnership: "📍",
    zoningPlanning: "🏡",
    councilCertificates: "💧",
    specialConditions: "⚖️",
    inclusionsExclusions: "🔒",
    strataDetails: "🏢",
    adjustments: "💰",
    disclosures: "🚨",
  };

  const sectionName = {
    contractTerms: "Contract Terms",
    titleOwnership: "Title & Ownership",
    zoningPlanning: "Zoning & Planning",
    councilCertificates: "Council Certificates",
    specialConditions: "Special Conditions",
    inclusionsExclusions: "Inclusions & Exclusions",
    strataDetails: "Strata Details",
    adjustments: "Adjustments & Settlement",
    disclosures: "Disclosure Documents",
  };

  const keyDetailsHtml = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f8fafc;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:10px 14px;border-right:1px solid #dce3f0;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">BUYER</div>
          <div style="font-size:13px;font-weight:700;color:#1a2744;">${r.buyerName || "—"}</div>
        </td>
        <td style="padding:10px 14px;border-right:1px solid #dce3f0;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">SELLER</div>
          <div style="font-size:13px;font-weight:600;color:#1a2744;">${r.sellerName || "—"}</div>
        </td>
        <td style="padding:10px 14px;border-right:1px solid #dce3f0;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">PRICE</div>
          <div style="font-size:13px;font-weight:700;color:#1a2744;">${r.purchasePrice || "—"}</div>
        </td>
        <td style="padding:10px 14px;border-right:1px solid #dce3f0;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">DEPOSIT</div>
          <div style="font-size:13px;font-weight:600;color:#1a2744;">${r.depositAmount || "—"}</div>
        </td>
        <td style="padding:10px 14px;border-right:1px solid #dce3f0;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">SETTLEMENT</div>
          <div style="font-size:13px;font-weight:600;color:#1a2744;">${r.settlementDate || "—"}</div>
        </td>
        <td style="padding:10px 14px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">COOLING OFF</div>
          <div style="font-size:13px;font-weight:600;color:#1a2744;">${r.coolingOffPeriod || "—"}</div>
        </td>
      </tr>
    </table>`;

  const riskBadgeHtml = `
    <div style="display:inline-flex;align-items:center;gap:10px;padding:12px 20px;
      background:${riskBg[risk] || riskBg.MEDIUM};border:2px solid ${riskColors[risk] || riskColors.MEDIUM};
      border-radius:10px;margin-bottom:20px;">
      <span style="font-size:24px;">${riskEmoji[risk] || riskEmoji.MEDIUM}</span>
      <div>
        <div style="font-size:16px;font-weight:800;color:${riskColors[risk] || riskColors.MEDIUM};">
          ${risk} RISK
        </div>
        <div style="font-size:11px;color:#6b7a99;margin-top:1px;">
          ${r.redFlags?.length || 0} red flag${(r.redFlags?.length || 0) !== 1 ? "s" : ""} identified
        </div>
      </div>
    </div>`;

  const sortedFlags = [...(r.redFlags || [])].sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const sa = String(a.severity || "").toUpperCase();
    const sb = String(b.severity || "").toUpperCase();
    return (order[sa] ?? 9) - (order[sb] ?? 9);
  });

  const flagColors = { CRITICAL: "#dc2626", HIGH: "#ea580c", MEDIUM: "#ca8a04", LOW: "#94a3b8" };
  const flagBg = { CRITICAL: "#fef2f2", HIGH: "#fff7ed", MEDIUM: "#fffbeb", LOW: "#f8fafc" };

  const redFlagsHtml =
    sortedFlags.length > 0
      ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;
      padding-bottom:8px;margin:24px 0 12px;">
      🚨 Red Flags (${sortedFlags.length} found)
    </h3>
    ${sortedFlags
      .map((f) => {
        const sev = String(f.severity || "").toUpperCase();
        return `
      <div style="border-left:4px solid ${flagColors[sev] || "#94a3b8"};
        background:${flagBg[sev] || "#f8fafc"};
        border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;
            background:${flagColors[sev] || "#94a3b8"};color:white;
            font-family:monospace;">
            ${f.severity}
          </span>
          <span style="font-size:11px;color:#6b7a99;font-family:monospace;">
            ${f.area || ""}
            ${f.clauseReference ? ` · ${f.clauseReference}` : ""}
          </span>
        </div>
        <div style="font-size:13px;font-weight:600;color:#1a2744;margin-bottom:6px;">
          ${f.issue || ""}
        </div>
        <div style="font-size:12px;color:#245eb0;background:#e8f0fb;
          padding:6px 10px;border-radius:5px;">
          💡 ${f.recommendation || ""}
        </div>
      </div>
    `;
      })
      .join("")}`
      : `<div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;
      color:#16a34a;font-weight:600;margin-bottom:20px;">
      ✓ No major red flags identified
    </div>`;

  const sectionsHtml = Object.entries(r.sections || {})
    .map(([key, section]) => {
      if (!section) return "";
      const status = String(section.status || "OK").toUpperCase();
      const details = section.details || [];
      const concerns = section.concerns || [];
      const easements = section.easements || [];
      const encumbrances = section.encumbrances || [];
      const overlays = section.overlays || [];

      const detailLine = (d) =>
        `<li style="font-size:11px;color:#6b7a99;margin-bottom:3px;
                  line-height:1.5;">${typeof d === "string" ? d : String(d)}</li>`;

      return `
      <div style="border:1px solid #dce3f0;border-radius:8px;
        margin-bottom:10px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:10px;
          padding:10px 14px;background:#f8fafc;
          border-bottom:1px solid #dce3f0;">
          <span style="font-size:16px;">${sectionIcon[key] || "📄"}</span>
          <span style="font-size:13px;font-weight:700;color:#1a2744;flex:1;">
            ${sectionName[key] || key}
          </span>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;
            border-radius:4px;font-family:monospace;
            background:${statusBg[status] || "#f8fafc"};
            color:${statusColor[status] || "#6b7a99"};">
            ${statusLabel[status] || status}
          </span>
        </div>
        <div style="padding:12px 14px;">
          ${
            section.summary
              ? `
            <div style="font-size:12px;color:#374151;margin-bottom:8px;line-height:1.6;">
              ${section.summary}
            </div>`
              : ""
          }
          ${
            details.length > 0
              ? `
            <ul style="margin:0 0 8px;padding-left:18px;">
              ${details.map((d) => detailLine(d)).join("")}
            </ul>`
              : ""
          }
          ${
            [...concerns, ...easements, ...encumbrances, ...overlays].length > 0
              ? `
            <div style="background:#fffbeb;border-left:3px solid #ca8a04;
              padding:8px 10px;border-radius:0 5px 5px 0;margin-top:6px;">
              ${[...concerns, ...easements, ...encumbrances, ...overlays]
                .map(
                  (c) => `
                <div style="font-size:11px;color:#92400e;margin-bottom:2px;">
                  ⚠ ${typeof c === "string" ? c : String(c)}
                </div>
              `
                )
                .join("")}
            </div>`
              : ""
          }
          ${
            key === "strataDetails" && section.applicable
              ? `
            <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
              ${
                section.levies
                  ? `
                <div style="background:#f8fafc;padding:6px 10px;border-radius:5px;">
                  <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Levies</div>
                  <div style="font-size:12px;font-weight:600;color:#1a2744;">${section.levies}</div>
                </div>`
                  : ""
              }
              ${
                section.sinkingFund
                  ? `
                <div style="background:#f8fafc;padding:6px 10px;border-radius:5px;">
                  <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Sinking Fund</div>
                  <div style="font-size:12px;font-weight:600;color:#1a2744;">${section.sinkingFund}</div>
                </div>`
                  : ""
              }
              ${
                section.specialLevies
                  ? `
                <div style="background:#fef2f2;padding:6px 10px;border-radius:5px;">
                  <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Special Levies</div>
                  <div style="font-size:12px;font-weight:600;color:#dc2626;">${section.specialLevies}</div>
                </div>`
                  : ""
              }
            </div>`
              : ""
          }
        </div>
      </div>`;
    })
    .join("");

  const actionsHtml =
    (r.recommendedActions || []).length > 0
      ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;
      padding-bottom:8px;margin:24px 0 12px;">
      ✅ Recommended Actions
    </h3>
    ${r.recommendedActions
      .map((a) => {
        const priorityColor = { URGENT: "#dc2626", HIGH: "#ea580c", MEDIUM: "#ca8a04", LOW: "#16a34a" };
        const pr = String(a.priority || "").toUpperCase();
        return `
        <div style="display:flex;gap:10px;padding:8px 12px;
          border-radius:6px;background:#f8fafc;margin-bottom:6px;
          border-left:3px solid ${priorityColor[pr] || "#94a3b8"};">
          <span style="font-size:10px;font-weight:700;padding:2px 7px;
            border-radius:3px;background:${priorityColor[pr] || "#94a3b8"};
            color:white;height:fit-content;white-space:nowrap;font-family:monospace;">
            ${a.priority}
          </span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#1a2744;">${a.action}</div>
            ${
              a.deadline
                ? `
              <div style="font-size:10px;color:#6b7a99;margin-top:2px;">
                ⏰ ${a.deadline}
              </div>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("")}`
      : "";

  const negotiationHtml =
    (r.negotiationPoints || []).length > 0
      ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;
      padding-bottom:8px;margin:24px 0 12px;">
      💬 Negotiation Points
    </h3>
    <ul style="margin:0;padding-left:20px;">
      ${r.negotiationPoints.map((p) => `
        <li style="font-size:12px;color:#374151;margin-bottom:6px;
          line-height:1.6;">${p}</li>
      `).join("")}
    </ul>`
      : "";

  const clientLetterHtml = r.clientLetter
    ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;
      padding-bottom:8px;margin:24px 0 12px;">
      ✉️ Draft Client Letter
    </h3>
    <div style="background:#f8fafc;border:1px solid #dce3f0;border-radius:8px;
      padding:16px 20px;font-size:12px;color:#374151;line-height:1.8;
      white-space:pre-wrap;">${r.clientLetter}</div>`
    : "";

  const emailBody = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:750px;margin:0 auto;">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a2744,#2d3f6b);
        color:white;padding:24px 28px;border-radius:10px 10px 0 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h2 style="margin:0;font-size:20px;font-weight:800;">
              ✦ Contract Review Complete
            </h2>
            <div style="margin:4px 0 0;opacity:0.7;font-size:12px;">
              Conveyancing Crew — AI Contract Review
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px;opacity:0.6;text-transform:uppercase;
              letter-spacing:1px;">Document</div>
            <div style="font-size:12px;font-weight:600;max-width:200px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${documentName}
            </div>
          </div>
        </div>
      </div>

      <div style="background:white;padding:24px 28px;
        border:1px solid #dce3f0;border-top:none;">
        
        <!-- Received from -->
        <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;
          padding-bottom:12px;border-bottom:1px solid #f0f0f0;">
          Received from: <strong style="color:#6b7a99;">
            ${email.from?.emailAddress?.name || ""}</strong>
          &lt;${email.from?.emailAddress?.address || ""}&gt; ·
          ${new Date(email.receivedDateTime || Date.now()).toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>

        <!-- Property address -->
        ${
          r.propertyAddress
            ? `
          <div style="font-size:18px;font-weight:800;color:#1a2744;
            margin-bottom:16px;">
            📍 ${r.propertyAddress}
          </div>`
            : ""
        }

        <!-- Key details bar -->
        ${keyDetailsHtml}

        <!-- Risk badge + summary -->
        ${riskBadgeHtml}
        
        <div style="font-size:13px;color:#374151;line-height:1.7;
          margin-bottom:20px;padding:14px 16px;background:#f8fafc;
          border-radius:8px;border-left:3px solid #245eb0;">
          ${r.overallSummary || ""}
        </div>

        <!-- Red flags -->
        ${redFlagsHtml}

        <!-- Recommended actions -->
        ${actionsHtml}

        <!-- Negotiation points -->
        ${negotiationHtml}

        <!-- Full sections report -->
        <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;
          padding-bottom:8px;margin:24px 0 12px;">
          📊 Full Report — All Sections
        </h3>
        ${sectionsHtml}

        <!-- Client letter -->
        ${clientLetterHtml}

        <!-- App link -->
        <div style="background:#f0f7ff;border:1px solid #bdd6f5;
          border-radius:8px;padding:16px;margin-top:24px;">
          <p style="margin:0;font-size:13px;color:#1a2744;">
            <strong>📱 View and action this review in the Conveyancing Crew app</strong><br>
            <span style="color:#666;font-size:12px;">
              Log in → Bell icon → Contract Reviews → 
              Link to matter or create new matter
            </span>
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:#f8f9fa;padding:12px 28px;text-align:center;
        font-size:10px;color:#999;border-radius:0 0 10px 10px;
        border:1px solid #dce3f0;border-top:none;">
        ${
          r._reviewCost
            ? `
        <div style="margin-bottom:12px;padding:10px 14px;text-align:left;
          background:#f0fdf4;border:1px solid #bbf7d0;
          border-radius:6px;font-size:11px;color:#15803d;">
          💰 AI Review Cost: <strong>AUD $${(typeof r._reviewCost.cost_aud === "number" ? r._reviewCost.cost_aud : 0).toFixed(2)}</strong>
          · ${(r._reviewCost.total_tokens ?? 0).toLocaleString()} tokens
          · ${r._reviewCost.pages_reviewed ?? 0} pages
        </div>`
            : ""
        }
        Conveyancing Crew · AI Contract Review · 
        Sent to ${GITU_NOTIFY_EMAIL} ·
        ${new Date().toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    </div>`;

  const message = {
    subject: `✦ Contract Review: ${r.propertyAddress || documentName} — ${riskEmoji[risk] || riskEmoji.MEDIUM} ${risk} RISK · ${r.redFlags?.length || 0} red flags`,
    body: { contentType: "HTML", content: emailBody },
    toRecipients: [{ emailAddress: { address: GITU_NOTIFY_EMAIL } }],
  };
  const fromAddr = email.from?.emailAddress?.address;
  if (fromAddr) {
    message.replyTo = [
      { emailAddress: { address: fromAddr, name: email.from?.emailAddress?.name || "" } },
    ];
  }

  await fetch(`https://graph.microsoft.com/v1.0/users/${graphUser}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  console.log("[ContractCron] Rich review email sent to", GITU_NOTIFY_EMAIL);
}

async function sendFailureEmail(accessToken, subjectLine, plainBody) {
  const graphUserEnc = encodeURIComponent(CONTRACTS_MAILBOX);
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const paragraphs = String(plainBody || "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
  await fetch(`https://graph.microsoft.com/v1.0/users/${graphUserEnc}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: String(subjectLine || "").slice(0, 250),
        body: {
          contentType: "HTML",
          content: `<div style="font-family:sans-serif;max-width:640px">${paragraphs}<p style="color:#666;font-size:13px">Conveyancing Crew · AI Contract Review</p></div>`,
        },
        toRecipients: [{ emailAddress: { address: GITU_NOTIFY_EMAIL } }],
      },
    }),
  });
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[ContractCron] Missing Supabase URL or service role key");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  console.log("[ContractCron] Starting inbox scan of", CONTRACTS_MAILBOX);

  try {
    const microsoftMailbox = process.env.MICROSOFT_MAILBOX_EMAIL?.trim();
    if (!microsoftMailbox) {
      console.error("[ContractCron] MICROSOFT_MAILBOX_EMAIL is not set");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
          tenant: process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID,
        }),
      }
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error("[ContractCron] Failed to get access token:", tokenData);
      return NextResponse.json({ error: "Auth failed" }, { status: 500 });
    }

    const graphUser = encodeURIComponent(CONTRACTS_MAILBOX);
    const graphGitu = encodeURIComponent(microsoftMailbox);
    const emailRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${graphUser}/messages` +
        `?$filter=isRead eq false` +
        `&$orderby=receivedDateTime desc` +
        `&$top=10` +
        `&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const emailData = await emailRes.json();
    const emails = emailData.value || [];

    console.log("[ContractCron] Unread emails found:", emails.length);

    const results = { processed: 0, skipped: 0, failed: 0, total: emails.length };

    const graphHeaders = {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: "eventual",
    };

    for (const email of emails) {
      let inboxRecord = null;
      let documentName = "document";
      let docType = "pdf";
      let isForwarded = false;
      let originalEmailSubject = "";
      let sourceMailbox = CONTRACTS_MAILBOX;
      let sourceEmailId = email.id;

      try {
        const { data: existing, error: existingErr } = await supabase
          .from("contract_review_inbox")
          .select("id, status, error_message, created_at")
          .eq("email_id", email.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingErr) {
          console.error("[ContractCron] Lookup existing inbox row failed:", existingErr);
          results.failed++;
          continue;
        }

        if (existing) {
          if (existing.status === "complete" || existing.status === "processing") {
            console.log("[ContractCron] Skipping — status is:", existing.status, "|", email.subject);
            results.skipped++;
            continue;
          }

          if (existing.status === "failed") {
            const ageMs = new Date() - new Date(existing.created_at || 0);
            const olderThan24h = ageMs > 24 * 60 * 60 * 1000;
            const isTerminal =
              existing.error_message?.includes("No attachments and not a forwarded email") ||
              existing.error_message?.includes("No PDF header found") ||
              (existing.error_message?.includes("none could be downloaded") && olderThan24h);
            if (isTerminal) {
              console.log(
                "[ContractCron] Skipping terminal failure:",
                email.subject,
                "|",
                existing.error_message?.slice(0, 80),
              );
              results.skipped++;
              continue;
            }
            console.log("[ContractCron] Retrying failed record:", email.subject);
            inboxRecord = existing;
            await supabase
              .from("contract_review_inbox")
              .update({
                status: "processing",
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          } else {
            console.log("[ContractCron] Skipping — unexpected status:", existing.status, "|", email.subject);
            results.skipped++;
            continue;
          }
        } else {
          const { data: newRecord, error: insertErr } = await supabase
            .from("contract_review_inbox")
            .insert({
              email_id: email.id,
              received_at: email.receivedDateTime,
              from_email: email.from?.emailAddress?.address,
              from_name: email.from?.emailAddress?.name,
              subject: email.subject,
              document_name: "",
              document_type: "",
              status: "processing",
              is_read: false,
            })
            .select()
            .single();

          if (insertErr || !newRecord?.id) {
            console.error("[ContractCron] Insert processing row failed:", insertErr);
            results.failed++;
            continue;
          }
          inboxRecord = newRecord;
        }

        await markEmailRead(accessToken, email.id);
        console.log("[ContractCron] Marked email as read:", email.subject);

        if (!email.hasAttachments && !isForwardedEmail(email.subject)) {
          console.log("[ContractCron] No attachments and not forwarded, skipping");
          await supabase
            .from("contract_review_inbox")
            .update({
              status: "failed",
              error_message: "No attachments and not a forwarded email",
              updated_at: new Date().toISOString(),
            })
            .eq("id", inboxRecord.id);
          results.skipped++;
          continue;
        }

        const attRes = await fetch(
          `https://graph.microsoft.com/v1.0/users/${graphUser}/messages/${email.id}/attachments`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const attData = await attRes.json();
        const forwardedAttachments = attData.value || [];

        console.log("[ContractCron] ========= ALL ATTACHMENTS FOUND (contractreview envelope) =========");
        forwardedAttachments.forEach((a, i) => {
          console.log(`[ContractCron] Attachment ${i + 1}:`, {
            name: a.name,
            contentType: a.contentType,
            size: Math.round((a.size || 0) / 1024) + "KB",
            id: a.id?.slice(0, 20) + "...",
          });
        });
        console.log("[ContractCron] ==========================================");

        const subject = email.subject || "";
        let linkHelpSubject = subject;
        isForwarded = isForwardedEmail(subject);

        console.log("[ContractCron] Subject:", subject);
        console.log("[ContractCron] Is forwarded:", isForwarded);

        const envelopeDocAttachments = forwardedAttachments.filter((a) => {
          const name = (a.name || "").toLowerCase();
          const type = (a.contentType || "").toLowerCase();
          return (
            name.endsWith(".pdf") ||
            name.endsWith(".docx") ||
            type.includes("pdf") ||
            type.includes("wordprocessingml") ||
            type.includes("msword")
          );
        });

        console.log(
          "[ContractCron] Direct attachments in contractreview@ envelope:",
          envelopeDocAttachments.map((a) => `"${a.name}" (${Math.round((a.size || 0) / 1024)}KB)`)
        );

        let sourceAttachments = [];
        let chainSenders = [];
        let sourceMailbox = CONTRACTS_MAILBOX;
        let sourceEmailId = email.id;

        originalEmailSubject = subject;

        if (envelopeDocAttachments.length > 1) {
          console.log(
            "[ContractCron] Processing",
            envelopeDocAttachments.length,
            "direct envelope attachments (separate inbox row each)"
          );

          await supabase.from("contract_review_inbox").delete().eq("id", inboxRecord.id);

          if (!process.env.ANTHROPIC_API_KEY) {
            await supabase.from("contract_review_inbox").insert({
              email_id: email.id,
              received_at: email.receivedDateTime,
              from_email: email.from?.emailAddress?.address,
              from_name: email.from?.emailAddress?.name,
              subject: email.subject,
              document_name: `Batch (${envelopeDocAttachments.length} files)`,
              document_type: "pdf",
              status: "failed",
              error_message: "ANTHROPIC_API_KEY is not configured",
              is_read: false,
            });
            results.failed++;
            continue;
          }

          let envProcessed = 0;
          let envFailed = 0;

          for (const att of envelopeDocAttachments) {
            const attDocType = (att.name || "").toLowerCase().endsWith(".docx") ? "docx" : "pdf";
            const nameSlug = (att.name || "file")
              .replace(/[^a-zA-Z0-9]/g, "_")
              .slice(0, 30);
            const idFrag = (att.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
            const attEmailId = `${email.id}_${idFrag}_${nameSlug}`;

            console.log("[ContractCron] Processing attachment:", att.name, "| inbox key:", attEmailId);

            const { data: existingAtt } = await supabase
              .from("contract_review_inbox")
              .select("id, status")
              .eq("email_id", attEmailId)
              .maybeSingle();

            if (existingAtt?.status === "complete") {
              console.log("[ContractCron] Already reviewed:", att.name);
              continue;
            }

            let attRecord;
            if (existingAtt) {
              attRecord = existingAtt;
              await supabase
                .from("contract_review_inbox")
                .update({ status: "processing", updated_at: new Date().toISOString() })
                .eq("id", existingAtt.id);
            } else {
              const { data: newAttRecord, error: insErr } = await supabase
                .from("contract_review_inbox")
                .insert({
                  email_id: attEmailId,
                  received_at: email.receivedDateTime,
                  from_email: email.from?.emailAddress?.address,
                  from_name: email.from?.emailAddress?.name,
                  subject: email.subject || "(no subject)",
                  document_name: att.name,
                  document_type: attDocType,
                  status: "processing",
                  is_read: false,
                })
                .select()
                .single();
              if (insErr || !newAttRecord?.id) {
                console.error("[ContractCron] Insert attachment row failed:", att.name, insErr);
                envFailed++;
                continue;
              }
              attRecord = newAttRecord;
            }

            try {
              const attContentRes = await fetch(
                `https://graph.microsoft.com/v1.0/users/${graphUser}/messages/${email.id}/attachments/${att.id}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              const attContentData = await attContentRes.json();
              const attBase64 = attContentData.contentBytes;

              if (!attBase64) throw new Error("Could not fetch attachment: " + att.name);

              const pdfBuffer = Buffer.from(attBase64, "base64");
              const attContext =
                `Contract received via email from ${email.from?.emailAddress?.name || ""} ` +
                `<${email.from?.emailAddress?.address || ""}>. Document: ${att.name}`;

              const attResult =
                attDocType === "docx"
                  ? await runDocxContractReview(pdfBuffer, attContext)
                  : await runContractReviewEngine(pdfBuffer, attContext);

              console.log(
                "[ContractCron] Review cost:",
                attResult._reviewCost?.cost_aud != null
                  ? `AUD $${attResult._reviewCost.cost_aud}`
                  : "unknown"
              );

              const { error: attSaveErr } = await supabase
                .from("contract_review_inbox")
                .update({
                  status: "complete",
                  review_result: attResult,
                  review_cost_aud: attResult._reviewCost?.cost_aud ?? null,
                  review_cost_usd: attResult._reviewCost?.cost_usd ?? null,
                  tokens_used: attResult._reviewCost?.total_tokens ?? null,
                  is_read: false,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", attRecord.id);

              if (!attSaveErr) {
                await linkOrCreateMatterFromContractReview(supabase, attResult, attRecord.id, email.id);
              } else {
                console.error("[ContractCron] contract_review_inbox update failed:", attSaveErr);
              }

              await sendReviewResultEmail(accessToken, email, att.name, attResult);

              console.log(
                "[ContractCron] ✓ Reviewed:",
                att.name,
                "| Risk:",
                attResult.overallRiskLevel
              );
              envProcessed++;
            } catch (attErr) {
              console.error("[ContractCron] Failed to review:", att.name, attErr.message);
              await supabase
                .from("contract_review_inbox")
                .update({
                  status: "failed",
                  error_message: attErr.message,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", attRecord.id);
              envFailed++;
            }
          }

          await supabase.from("contract_review_inbox").insert({
            email_id: email.id,
            received_at: email.receivedDateTime,
            from_email: email.from?.emailAddress?.address,
            from_name: email.from?.emailAddress?.name,
            subject: email.subject || "(no subject)",
            document_name: `Envelope batch (${envelopeDocAttachments.length} files)`,
            document_type: "pdf",
            status: envFailed === 0 ? "complete" : "failed",
            error_message:
              envFailed > 0 ? `${envFailed} attachment(s) failed; ${envProcessed} succeeded` : null,
            review_result: {
              envelopeBatch: true,
              attachmentCount: envelopeDocAttachments.length,
              processed: envProcessed,
              failed: envFailed,
            },
            is_read: true,
          });

          results.processed += envProcessed;
          results.failed += envFailed;
          continue;
        }

        if (envelopeDocAttachments.length > 0) {
          console.log("[ContractCron] Direct attachments found — skipping inbox search");
          sourceAttachments = envelopeDocAttachments;
          sourceMailbox = CONTRACTS_MAILBOX;
          sourceEmailId = email.id;
        } else if (isForwarded) {
          console.log("[ContractCron] Forwarded email — searching Gitu mailbox for original (ignoring contractreview envelope)...");

          let cleanSubject = subject;
          while (/^(fwd?:|fw:)\s*/i.test(cleanSubject.trim())) {
            cleanSubject = cleanSubject.replace(/^(fwd?:|fw:)\s*/i, "").trim();
          }

          linkHelpSubject = cleanSubject;

          console.log("[ContractCron] Clean subject:", cleanSubject || "(empty)");

          const senderName = email.from?.emailAddress?.name || "";
          const senderEmail = email.from?.emailAddress?.address || "";
          let hasNoSubject = !cleanSubject || cleanSubject.length < 3;
          const gituEmailLower = (microsoftMailbox || GITU_NOTIFY_EMAIL).toLowerCase();
          const senderIsGitu = senderEmail.toLowerCase() === gituEmailLower;

          let searchSenderName = senderName;
          let searchSenderEmail = senderEmail;
          let originalSenderName = "";
          let originalSenderEmail = "";

          console.log("[ContractCron] Sender:", senderName, senderEmail);
          console.log("[ContractCron] Has no subject:", hasNoSubject);

          if (hasNoSubject && senderIsGitu) {
            try {
              const bodyRes = await fetch(
                `https://graph.microsoft.com/v1.0/users/${graphUser}/messages/${email.id}?$select=body`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              const bodyData = await bodyRes.json();
              const bodyText = (bodyData.body?.content || "")
                .replace(/<[^>]*>/g, " ")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&")
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, " ");

              console.log("[ContractCron] Body for sender extraction:", bodyText.slice(0, 500));

              const fromMatch = bodyText.match(/From:\s*([^<\n]+?)\s*<([^>]+)>/i);
              if (fromMatch) {
                originalSenderName = fromMatch[1].trim();
                originalSenderEmail = fromMatch[2].trim();
                console.log(
                  "[ContractCron] Original sender from body:",
                  originalSenderName,
                  originalSenderEmail
                );
                searchSenderName = originalSenderName || searchSenderName;
                searchSenderEmail = originalSenderEmail || searchSenderEmail;
              }

              const subjMatch = bodyText.match(/Subject:\s*([^\n\r]+)/i);
              if (subjMatch) {
                const extractedSubject = subjMatch[1].trim();
                console.log("[ContractCron] Extracted subject from body:", extractedSubject);
                if (extractedSubject && extractedSubject.length > 3) {
                  cleanSubject = extractedSubject.replace(/^(fwd?:|fw:)\s*/gi, "").trim();
                  hasNoSubject = false;
                  linkHelpSubject = cleanSubject;
                  console.log("[ContractCron] Recovered subject from body:", cleanSubject);
                }
              }
            } catch (e) {
              console.log("[ContractCron] Could not extract body sender:", e.message);
            }
          }

          let searchWords = "";

          const buildSearchWordsFromSubject = (subj) =>
            subj
              .replace(/[^a-zA-Z0-9\s]/g, " ")
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .filter(
                (w) =>
                  ![
                    "property",
                    "documents",
                    "document",
                    "sale",
                    "purchase",
                    "from",
                    "with",
                    "contract",
                    "fwd",
                    "street",
                    "avenue",
                    "road",
                    "drive",
                    "court",
                    "place",
                    "lane",
                  ].includes(w.toLowerCase())
              )
              .slice(0, 3)
              .join(" ")
              .trim();

          if (!hasNoSubject) {
            searchWords = buildSearchWordsFromSubject(cleanSubject);
          } else if (
            originalSenderEmail &&
            originalSenderEmail.toLowerCase() !== GITU_NOTIFY_EMAIL.toLowerCase()
          ) {
            searchWords = originalSenderName
              .replace(/[^a-zA-Z0-9\s]/g, " ")
              .split(/\s+/)
              .filter((w) => w.length > 2)
              .slice(0, 3)
              .join(" ")
              .trim();
            if (!searchWords.trim()) {
              searchWords = (originalSenderEmail.split("@")[0] || "")
                .replace(/[^a-zA-Z0-9\s]/g, " ")
                .trim();
            }
            console.log("[ContractCron] No subject — searching by original sender:", searchWords);
          } else if (!senderIsGitu) {
            searchWords = senderName
              .replace(/[^a-zA-Z0-9\s]/g, " ")
              .split(/\s+/)
              .filter((w) => w.length > 2)
              .slice(0, 3)
              .join(" ")
              .trim();
            console.log("[ContractCron] No subject — searching by forwarder name:", searchWords);
          } else {
            searchWords = "";
            console.log("[ContractCron] No subject, Gitu forwarder — no search words until fallback");
          }

          if (!hasNoSubject && !searchWords.trim()) {
            searchWords = buildSearchWordsFromSubject(cleanSubject);
          }

          if (!searchWords.trim() && searchSenderEmail) {
            searchWords = (searchSenderEmail.split("@")[0] || "")
              .replace(/[^a-zA-Z0-9\s]/g, " ")
              .trim();
            console.log("[ContractCron] Fallback to email username:", searchWords);
          }

          console.log("[ContractCron] Final search words:", searchWords || "(none)");

          const minScore = hasNoSubject ? 30 : 20;

          const scoreEmail = (m) => {
            const mSubj = (m.subject || "").toLowerCase();
            const mFrom = (
              (m.from?.emailAddress?.address || "") +
              " " +
              (m.from?.emailAddress?.name || "")
            ).toLowerCase();

            if (hasNoSubject) {
              let score = 0;
              if (searchSenderEmail && mFrom.includes(searchSenderEmail.toLowerCase())) {
                score += 50;
              }
              if (searchSenderName) {
                const senderWords = searchSenderName
                  .toLowerCase()
                  .split(/\s+/)
                  .filter((w) => w.length > 2);
                const matchedSender = senderWords.filter((w) => mFrom.includes(w));
                score += matchedSender.length * 20;
              }
              if (m.hasAttachments) score += 30;
              const daysSince =
                (Date.now() - new Date(m.receivedDateTime).getTime()) / 86400000;
              if (daysSince < 1) score += 20;
              else if (daysSince < 3) score += 15;
              else if (daysSince < 7) score += 10;
              if (mSubj.includes("contract")) score += 20;
              if (mSubj.includes("sale")) score += 10;
              if (mSubj.includes("purchase")) score += 10;
              if (mSubj.includes("property")) score += 5;
              if (mSubj.includes("document")) score += 5;
              return score;
            }
            const cleanLower = cleanSubject.toLowerCase();
            const uniqueWords = cleanSubject
              .toLowerCase()
              .replace(/[^a-zA-Z0-9\s]/g, " ")
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .filter(
                (w) =>
                  ![
                    "property",
                    "documents",
                    "document",
                    "sale",
                    "purchase",
                    "from",
                    "with",
                    "contract",
                    "fwd",
                    "street",
                    "avenue",
                    "road",
                    "drive",
                    "court",
                    "place",
                    "lane",
                  ].includes(w)
              );

            if (mSubj === cleanLower) return 100;
            if (mSubj.includes(cleanLower)) return 80;
            if (cleanLower.includes(mSubj) && mSubj.length > 10) return 70;

            const matched = uniqueWords.filter((w) => mSubj.includes(w));
            return matched.length >= 2
              ? matched.length * 15
              : matched.length === 1
                ? 8
                : 0;
          };

          let originalEmail = null;

          if (hasNoSubject && !searchWords.trim()) {
            console.log(
              "[ContractCron] No subject and no search words — fetching most recent attachment emails (24h)"
            );
            try {
              const oneDayAgo = new Date();
              oneDayAgo.setDate(oneDayAgo.getDate() - 1);
              const recentFilter = `hasAttachments eq true and receivedDateTime ge ${oneDayAgo.toISOString()}`;
              const recentRes = await fetch(
                `https://graph.microsoft.com/v1.0/users/${graphGitu}/mailFolders/Inbox/messages` +
                  `?$filter=${encodeURIComponent(recentFilter)}` +
                  `&$top=10` +
                  `&$select=id,subject,from,receivedDateTime,hasAttachments`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              const recentData = await recentRes.json();
              if (recentData.error) {
                console.log("[ContractCron] Recent attachment API error:", recentData.error?.message);
              } else {
                const recentWithAtt = filterOutOurReviewEmails(recentData.value || []);

                console.log(
                  "[ContractCron] Recent emails with attachments (last 24h):",
                  recentWithAtt.map((e) => `"${e.subject || "(no subject)"}"`)
                );

                if (recentWithAtt.length > 0) {
                  originalEmail = recentWithAtt[0];
                  console.log(
                    "[ContractCron] Using most recent attachment email:",
                    originalEmail.subject || "(no subject)"
                  );
                }
              }
            } catch (e) {
              console.log("[ContractCron] Recent attachment search failed:", e.message);
            }
          }

          const s1Headers = {
            Authorization: `Bearer ${accessToken}`,
            ConsistencyLevel: "eventual",
          };

          try {
            if (!originalEmail && searchWords.trim()) {
              const s1Url =
                `https://graph.microsoft.com/v1.0/users/${graphGitu}/mailFolders/Inbox/messages` +
                `?$search="${encodeURIComponent(searchWords)}"` +
                `&$top=25` +
                `&$select=id,subject,receivedDateTime,hasAttachments,from`;

              const s1Res = await fetch(s1Url, { headers: s1Headers });
              const s1Data = await s1Res.json();

              if (s1Data.error) {
                console.log("[ContractCron] Strategy 1 error:", s1Data.error.message || JSON.stringify(s1Data.error));
              } else {
                const s1Filtered = filterOutOurReviewEmails(s1Data.value);
                console.log("[ContractCron] Strategy 1 results:", s1Filtered.length, "(after filter)");
                console.log("[ContractCron] Strategy 1 subjects:", s1Filtered.map((e) => e.subject));

                const matches = s1Filtered
                  .map((m) => ({ ...m, score: scoreEmail(m) }))
                  .filter((m) => m.score >= minScore)
                  .sort((a, b) => b.score - a.score);

                if (matches.length > 0) {
                  originalEmail = matches[0];
                  console.log(
                    "[ContractCron] Strategy 1 matched:",
                    originalEmail.subject,
                    "| Score:",
                    originalEmail.score
                  );
                }
              }
            } else if (!originalEmail && !searchWords.trim()) {
              console.log("[ContractCron] Strategy 1 skipped: no search words");
            }
          } catch (e) {
            console.log("[ContractCron] Strategy 1 exception:", e.message);
          }

          if (!originalEmail && hasNoSubject) {
            console.log("[ContractCron] No-subject mode: fetching recent emails from sender...");
            try {
              const senderQuery = searchSenderEmail || searchSenderName || senderEmail || senderName;
              if (senderQuery) {
                const s2NsRes = await fetch(
                  `https://graph.microsoft.com/v1.0/users/${graphGitu}/messages` +
                    `?$search="${encodeURIComponent(senderQuery)}"` +
                    `&$top=20` +
                    `&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      ConsistencyLevel: "eventual",
                    },
                  }
                );
                const s2NsData = await s2NsRes.json();

                if (!s2NsData.error) {
                  const s2NsFiltered = filterOutOurReviewEmails(s2NsData.value);
                  console.log("[ContractCron] Sender search results:", s2NsFiltered.length, "(after filter)");
                  console.log(
                    "[ContractCron] Sender search subjects:",
                    s2NsFiltered.map((e) => `"${e.subject}" hasAtt:${e.hasAttachments}`)
                  );

                  const scored = s2NsFiltered
                    .map((m) => ({ ...m, score: scoreEmail(m) }))
                    .filter((m) => m.score >= minScore)
                    .sort((a, b) => b.score - a.score);

                  console.log(
                    "[ContractCron] Sender search matches:",
                    scored.map((m) => `"${m.subject}" score:${m.score}`)
                  );

                  if (scored.length > 0) {
                    originalEmail = scored[0];
                    console.log(
                      "[ContractCron] No-subject match found:",
                      originalEmail.subject || "(no subject)",
                      "| Score:",
                      originalEmail.score
                    );
                  }
                } else {
                  console.log("[ContractCron] Sender search error:", s2NsData.error?.code);
                }
              }
            } catch (e) {
              console.log("[ContractCron] Sender search exception:", e.message);
            }
          }

          if (!originalEmail) {
            console.log("[ContractCron] Strategy 2: Recent inbox scan (newest first)...");
            try {
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
              const dateFilter = thirtyDaysAgo.toISOString();
              const s2Filter = `receivedDateTime ge ${dateFilter}`;
              const s2Res = await fetch(
                `https://graph.microsoft.com/v1.0/users/${graphGitu}/mailFolders/Inbox/messages` +
                  `?$filter=${encodeURIComponent(s2Filter)}` +
                  `&$top=50` +
                  `&$select=id,subject,receivedDateTime,hasAttachments,from`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              const s2Data = await s2Res.json();

              if (s2Data.error) {
                console.log("[ContractCron] Strategy 2 error:", s2Data.error.message || JSON.stringify(s2Data.error));
              } else {
                const recentEmails = filterOutOurReviewEmails(s2Data.value || []);
                console.log("[ContractCron] Strategy 2: Recent inbox emails:", recentEmails.length, "(after filter)");
                console.log(
                  "[ContractCron] Strategy 2 subjects:",
                  recentEmails.map(
                    (e) => `${e.subject} (${new Date(e.receivedDateTime).toLocaleDateString("en-AU")})`
                  )
                );

                const matches = recentEmails
                  .map((m) => ({ ...m, score: scoreEmail(m) }))
                  .filter((m) => m.score >= minScore)
                  .sort((a, b) => b.score - a.score);

                console.log("[ContractCron] Strategy 2 matches:", matches.map((m) => `"${m.subject}" score:${m.score}`));

                if (matches.length > 0) {
                  originalEmail = matches[0];
                  console.log("[ContractCron] Strategy 2 matched:", originalEmail.subject);
                }
              }
            } catch (e) {
              console.log("[ContractCron] Strategy 2 exception:", e.message);
            }
          }

          if (!originalEmail) {
            console.log("[ContractCron] Strategy 3: All mail search...");
            try {
              const sixtyDaysAgo = new Date();
              sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
              const dateFilter60 = sixtyDaysAgo.toISOString();
              const s3Filter = `receivedDateTime ge ${dateFilter60}`;
              const s3Res = await fetch(
                `https://graph.microsoft.com/v1.0/users/${graphGitu}/messages` +
                  `?$filter=${encodeURIComponent(s3Filter)}` +
                  `&$top=100` +
                  `&$select=id,subject,receivedDateTime,hasAttachments,from`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              const s3Data = await s3Res.json();

              if (!s3Data.error) {
                const allEmails = filterOutOurReviewEmails(s3Data.value || []);
                console.log("[ContractCron] Strategy 3: All recent emails:", allEmails.length, "(after filter)");

                const matches = allEmails
                  .map((m) => ({ ...m, score: scoreEmail(m) }))
                  .filter((m) => m.score >= minScore)
                  .sort((a, b) => b.score - a.score);

                console.log(
                  "[ContractCron] Strategy 3 matches:",
                  matches.map((m) => `"${m.subject}" score:${m.score}`)
                );

                if (matches.length > 0) {
                  originalEmail = matches[0];
                  console.log("[ContractCron] Strategy 3 matched:", originalEmail.subject);
                }
              } else {
                console.log("[ContractCron] Strategy 3 error:", s3Data.error.message || JSON.stringify(s3Data.error));
              }
            } catch (e) {
              console.log("[ContractCron] Strategy 3 exception:", e.message);
            }
          }

          if (!originalEmail) {
            console.log("[ContractCron] All strategies failed for:", cleanSubject || "(empty)");

            const failureMessagePlain = hasNoSubject
              ? `We received your forwarded email but it had no subject line, making it difficult to find the original email in your inbox. We searched for emails from: ${senderName} (${senderEmail}). To fix: Please forward the email again with the original subject line included, or forward the email with the contract attached directly.`
              : `Could not find original email in Gitu inbox. Searched for: "${cleanSubject}"`;

            const failureHtml = hasNoSubject
              ? `<p>Hi Gitu,</p>
<p>We received your forwarded email but it had no subject line, making it difficult to find the original email in your inbox.</p>
<p>We searched for emails from: <strong>${senderName.replace(/</g, "&lt;")}</strong> (<strong>${senderEmail.replace(/</g, "&lt;")}</strong>)</p>
<p><strong>To fix:</strong> Please forward the email again with the original subject line included, or forward the email with the contract attached directly.</p>
<p>Conveyancing Crew · AI Contract Review</p>`
              : `<p>Hi Gitu,</p>
<p>We received your forwarded email but could not find the original in your inbox.</p>
<p><strong>You forwarded:</strong> "${subject.replace(/</g, "&lt;")}"</p>
<p><strong>Searched for:</strong> "${String(cleanSubject).replace(/</g, "&lt;")}"</p>
<p><strong>Tip:</strong> Make sure the original email is in your Inbox (not archived) and was received within the last 60 days.</p>
<p>Conveyancing Crew · AI Contract Review</p>`;

            const { error: failUpdateErr } = await supabase
              .from("contract_review_inbox")
              .update({
                document_name: "(forwarded — original not found)",
                document_type: "pdf",
                status: "failed",
                error_message: failureMessagePlain,
                updated_at: new Date().toISOString(),
              })
              .eq("id", inboxRecord.id);

            if (failUpdateErr) {
              console.error("[ContractCron] Failed to update failure row:", failUpdateErr);
            }

            await fetch(`https://graph.microsoft.com/v1.0/users/${graphUser}/sendMail`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  subject: `⚠ Contract Review: Could not find original email`,
                  body: {
                    contentType: "HTML",
                    content: failureHtml,
                  },
                  toRecipients: [{ emailAddress: { address: microsoftMailbox } }],
                },
              }),
            });

            results.failed++;
            continue;
          }

          console.log(
            "[ContractCron] Original email found:",
            originalEmail.subject || "(no subject)",
            "| Received:",
            originalEmail.receivedDateTime
          );

          const pushChainSender = (addr, name) => {
            if (!addr || typeof addr !== "string") return;
            const lower = addr.toLowerCase();
            if (chainSenders.some((s) => (s.email || "").toLowerCase() === lower)) return;
            chainSenders.push({ email: addr, name: name || "" });
          };
          chainSenders = [];
          pushChainSender(originalEmail.from?.emailAddress?.address, originalEmail.from?.emailAddress?.name);
          pushChainSender(senderEmail, senderName);
          if (originalSenderEmail) pushChainSender(originalSenderEmail, originalSenderName);
          pushChainSender(email.from?.emailAddress?.address, email.from?.emailAddress?.name);

          const origAttRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${graphGitu}/messages/${originalEmail.id}/attachments` +
              `?$select=id,name,contentType,size`,
            { headers: graphHeaders }
          );
          const origAttData = await origAttRes.json();
          sourceAttachments = origAttData.value || [];
          sourceMailbox = microsoftMailbox;
          sourceEmailId = originalEmail.id;
          originalEmailSubject = originalEmail.subject || "";

          console.log(
            "[ContractCron] Attachments in original email:",
            sourceAttachments.map((a) => `"${a.name}" (${Math.round((a.size || 0) / 1024)}KB)`)
          );
        } else {
          console.log("[ContractCron] No PDF/DOCX on envelope and not a forward — skipping");
          await supabase
            .from("contract_review_inbox")
            .update({
              status: "failed",
              error_message: "No contract attachment on envelope and email was not forwarded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", inboxRecord.id);
          await markEmailRead(accessToken, email.id);
          results.skipped++;
          continue;
        }

        const docAttachments = sourceAttachments.filter((a) => {
          const name = (a.name || "").toLowerCase();
          const type = (a.contentType || "").toLowerCase();
          return (
            name.endsWith(".pdf") ||
            name.endsWith(".docx") ||
            type.includes("pdf") ||
            type.includes("wordprocessingml") ||
            type.includes("msword")
          );
        });

        console.log(
          "[ContractCron] Document attachments available:",
          docAttachments.map((a) => `"${a.name}" (${Math.round((a.size || 0) / 1024)}KB)`)
        );

        let contractAtt = null;
        let base64Content = null;
        let contractFromUrl = false;

        if (docAttachments.length > 0) {
          const scored = docAttachments.map((a) => {
            const name = (a.name || "").toLowerCase();
            let score = 0;

            if (name.includes("contract")) score += 20;
            if (name.includes("sale")) score += 10;
            if (name.includes("purchase")) score += 10;
            if (name.includes("agreement")) score += 8;
            if (name.includes("transfer")) score += 6;
            if (name.includes("conveyancing")) score += 6;
            if (name.includes("property")) score += 4;
            if (name.includes("lot")) score += 4;

            if (name.includes("cover")) score -= 15;
            if (name.includes("letter")) score -= 10;
            if (name.includes("invoice")) score -= 15;
            if (name.includes("receipt")) score -= 15;
            if (name.includes("trust account")) score -= 15;
            if (name.includes("section 66")) score -= 10;
            if (name.includes("s66")) score -= 10;
            if (name.includes("certificate")) score -= 8;
            if (name.includes("id")) score -= 8;
            if (name.includes("passport")) score -= 15;
            if (name.includes("licence") || name.includes("license")) score -= 15;
            if (name.includes("identification")) score -= 15;
            if (name.includes("photo")) score -= 10;
            if (name.includes("authority")) score -= 5;

            const sizeKB = (a.size || 0) / 1024;
            if (sizeKB > 1000) score += 10;
            else if (sizeKB > 500) score += 6;
            else if (sizeKB > 200) score += 3;
            else if (sizeKB < 100) score -= 5;

            console.log(`[ContractCron] Score for "${a.name}": ${score} (${Math.round(sizeKB)}KB)`);
            return { attachment: a, score };
          });

          scored.sort((a, b) => b.score - a.score);
          contractAtt = scored[0].attachment;

          console.log(
            "[ContractCron] SELECTED:",
            contractAtt.name,
            "| Score:",
            scored[0].score,
            "| Size:",
            Math.round((contractAtt.size || 0) / 1024),
            "KB"
          );

          docType = (contractAtt.name || "").toLowerCase().endsWith(".docx") ? "docx" : "pdf";
          documentName = contractAtt.name || "document";
        } else {
          function transformGoogleDriveUrl(url) {
            const fileMatch = url.match(
              /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/
            );
            if (fileMatch) {
              return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}&confirm=t`;
            }
            const openMatch = url.match(
              /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/
            );
            if (openMatch) {
              return `https://drive.google.com/uc?export=download&id=${openMatch[1]}&confirm=t`;
            }
            const docsMatch = url.match(
              /docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/
            );
            if (docsMatch) {
              return `https://drive.google.com/uc?export=download&id=${docsMatch[1]}&confirm=t`;
            }
            return url;
          }

          function transformDropboxUrl(url) {
            if (url.includes('dropbox.com')) {
              return url
                .replace('?dl=0', '?dl=1')
                .replace('www.dropbox.com', 'dl.dropboxusercontent.com');
            }
            return url;
          }

          function transformSharePointUrl(url) {
            if (url.includes("sharepoint.com")) {
              if (url.includes("?")) {
                return url + "&download=1";
              }
              return url + "?download=1";
            }
            if (url.includes("1drv.ms") || url.includes("onedrive.live.com")) {
              if (url.includes("?")) {
                return url + "&download=1";
              }
              return url + "?download=1";
            }
            return url;
          }
          function normalizeDocUrl(url) {
            url = transformGoogleDriveUrl(url);
            url = transformDropboxUrl(url);
            url = transformSharePointUrl(url);
            return url;
          }

          console.log("[ContractCron] No document attachments — checking email body for links (incl. chain)...");

          const normalizeBodyText = (html) =>
            (html || "")
              .replace(/<[^>]*>/g, " ")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/\s+/g, " ");

          const graphUserBody = encodeURIComponent(sourceMailbox);
          const bodyRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${graphUserBody}/messages/${sourceEmailId}?$select=body,bodyPreview`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const bodyData = await bodyRes.json();
          const primaryHtml = bodyData.body?.content || bodyData.bodyPreview || "";
          const rawText = normalizeBodyText(primaryHtml);

          const bodyParts = [{ html: primaryHtml, text: rawText }];

          for (const sender of chainSenders.slice(0, 3)) {
            try {
              const chainBodyRes = await fetch(
                `https://graph.microsoft.com/v1.0/users/${graphGitu}/messages` +
                  `?$search="${encodeURIComponent(sender.email)}"` +
                  `&$top=5` +
                  `&$select=id,subject,body,hasAttachments`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    ConsistencyLevel: "eventual",
                  },
                }
              );
              const chainBodyData = await chainBodyRes.json();

              for (const chainMsg of (chainBodyData.value || []).slice(0, 3)) {
                const fullRes = await fetch(
                  `https://graph.microsoft.com/v1.0/users/${graphGitu}/messages/${chainMsg.id}?$select=body`,
                  { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                const fullData = await fullRes.json();
                const chainHtml = fullData.body?.content || "";
                bodyParts.push({
                  html: chainHtml,
                  text: normalizeBodyText(chainHtml),
                });
              }
            } catch (e) {
              console.log("[ContractCron] Could not fetch chain body:", e.message);
            }
          }

          console.log("[ContractCron] Email body parts for link scan:", bodyParts.length);

          const hrefPattern = /href=["']([^"']+)["']/gi;
          const textUrlPattern = /https?:\/\/[^\s<>"',)]+/gi;
          const allLinksFound = [];

          for (const { html, text } of bodyParts) {
            const hrefUrls = [...html.matchAll(hrefPattern)].map((m) => m[1]);
            const textUrls = text.match(textUrlPattern) || [];
            allLinksFound.push(...hrefUrls, ...textUrls);
          }

          const uniqueLinks = [...new Set(allLinksFound)].filter((u) => u.startsWith("http"));

          console.log("[ContractCron] Total unique links found across chain:", uniqueLinks.length);

          const cleanSubject = String(linkHelpSubject || subject || email.subject || "(no subject)");

          if (uniqueLinks.length === 0) {
            await supabase
              .from("contract_review_inbox")
              .update({
                status: "failed",
                error_message:
                  "No contract attachment or link found in email chain. Chain senders: " +
                  chainSenders.map((s) => s.email).join(", "),
                updated_at: new Date().toISOString(),
              })
              .eq("id", inboxRecord.id);

            await sendFailureEmail(
              accessToken,
              `No contract found — ${email.subject}`,
              `Could not find a contract in this email or its forward chain.\n\n` +
                `Chain senders searched: ${chainSenders.map((s) => `${s.name} <${s.email}>`).join(", ") || "(none)"}\n\n` +
                `Please forward the original email with the contract PDF attached directly ` +
                `to contractreview@conveyancingcrew.com.au`
            );
            results.skipped++;
            continue;
          }

          const resolvedLinks = [];

          for (const url of uniqueLinks.slice(0, 15)) {
            const urlLower = url.toLowerCase();

            if (urlLower.includes("google.com/maps")) continue;
            if (urlLower.includes("unsubscribe")) continue;
            if (urlLower.includes(".png") || urlLower.includes(".jpg")) continue;
            if (urlLower.includes("privacy")) continue;

            const isRedirect =
              urlLower.includes("click?") ||
              urlLower.includes("/ls/click") ||
              urlLower.includes("agentbox") ||
              urlLower.includes("mailchimp") ||
              urlLower.includes("sendgrid") ||
              urlLower.includes("campaign-archive") ||
              urlLower.includes("link.");

            if (isRedirect) {
              try {
                console.log("[ContractCron] Following redirect:", url.slice(0, 80));
                const redirectRes = await fetch(url, {
                  method: "GET",
                  redirect: "follow",
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  },
                  signal: AbortSignal.timeout(8000),
                });

                const finalUrl = redirectRes.url;
                console.log("[ContractCron] Resolved to:", finalUrl.slice(0, 120));

                if (finalUrl !== url) {
                  resolvedLinks.push({ original: url, resolved: finalUrl });
                }

                const contentType = redirectRes.headers.get("content-type") || "";
                if (contentType.includes("pdf") || contentType.includes("wordprocessingml")) {
                  console.log(
                    "[ContractCron] Redirect returned document directly! Type:",
                    contentType
                  );
                  const arrayBuffer = await redirectRes.arrayBuffer();
                  if (arrayBuffer.byteLength > 10000) {
                    base64Content = Buffer.from(arrayBuffer).toString("base64");
                    docType = contentType.includes("wordprocessingml") ? "docx" : "pdf";
                    try {
                      const pathPart = finalUrl.split("/").pop()?.split("?")[0] || "";
                      documentName = decodeURIComponent(pathPart) || "contract.pdf";
                    } catch {
                      documentName = "contract.pdf";
                    }
                    console.log(
                      "[ContractCron] ✓ Got document from redirect:",
                      documentName,
                      Math.round(arrayBuffer.byteLength / 1024),
                      "KB"
                    );
                    contractFromUrl = true;
                    await supabase
                      .from("contract_review_inbox")
                      .update({ document_name: documentName, document_type: docType })
                      .eq("id", inboxRecord.id);
                    break;
                  }
                }
              } catch (redirectErr) {
                console.log("[ContractCron] Redirect failed:", redirectErr.message);
              }

              if (base64Content) break;
            } else {
              resolvedLinks.push({ original: url, resolved: url });
            }
          }

          let docLinks = [];
          if (!base64Content) {
            console.log(
              "[ContractCron] Resolved links:",
              resolvedLinks.map((l) => l.resolved.slice(0, 100))
            );

            const allUrlsToScore = [
              ...resolvedLinks.map((l) => l.resolved),
              ...uniqueLinks.filter((u) => !u.toLowerCase().includes("click?")),
            ];

            docLinks = [...new Set(allUrlsToScore)]
              .map((url) => {
                const urlLower = url.toLowerCase();
                let score = 0;
                if (urlLower.includes(".pdf")) score += 25;
                if (urlLower.includes(".docx")) score += 25;
                if (urlLower.includes("contract")) score += 20;
                if (urlLower.includes("document")) score += 15;
                if (urlLower.includes("download")) score += 15;
                if (urlLower.includes("sharepoint")) score += 40;
                if (urlLower.includes("onedrive")) score += 40;
                if (urlLower.includes("1drv.ms")) score += 40;
                if (urlLower.includes("dropbox")) score += 35;
                if (urlLower.includes("drive.google")) score += 40;
                if (urlLower.includes("docs.google")) score += 40;
                if (urlLower.includes("infotrack")) score += 20;
                if (urlLower.includes("agentbox")) score += 10;
                if (urlLower.includes("realestate")) score += 8;
                if (urlLower.includes("domain.com")) score += 5;
                if (urlLower.includes("property")) score += 5;
                if (urlLower.includes("view")) score += 5;
                if (urlLower.includes("file")) score += 5;
                if (urlLower.includes("google.com/maps")) score -= 20;
                if (urlLower.includes(".png") || urlLower.includes(".jpg") || urlLower.includes(".gif"))
                  score -= 20;
                if (urlLower.includes("unsubscribe")) score -= 20;
                if (urlLower.includes("logo")) score -= 15;
                if (urlLower.includes("privacy")) score -= 10;
                if (urlLower.includes("belleproperty.com") && !urlLower.includes(".pdf")) score += 8;
                return { url, score };
              })
              .filter((u) => u.score > 0)
              .sort((a, b) => b.score - a.score);

            console.log(
              "[ContractCron] Scored resolved links:",
              docLinks.slice(0, 5).map((u) => `score:${u.score} ${u.url.slice(0, 100)}`)
            );

            for (const { url } of docLinks.slice(0, 5)) {
              try {
                console.log("[ContractCron] Trying download:", url.slice(0, 100));
                const dlRes = await fetch(normalizeDocUrl(url), {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    Authorization: `Bearer ${accessToken}`,
                  },
                  redirect: "follow",
                  signal: AbortSignal.timeout(15000),
                });

                if (!dlRes.ok) {
                  console.log("[ContractCron] Download status:", dlRes.status, "— trying next");
                  continue;
                }

                const contentType = dlRes.headers.get("content-type") || "";
                const arrayBuffer = await dlRes.arrayBuffer();

                if (arrayBuffer.byteLength < 10000) {
                  console.log("[ContractCron] File too small:", arrayBuffer.byteLength, "— skipping");
                  continue;
                }

                base64Content = Buffer.from(arrayBuffer).toString("base64");
                docType =
                  contentType.includes("wordprocessingml") || url.toLowerCase().includes(".docx")
                    ? "docx"
                    : "pdf";
                try {
                  const pathPart = url.split("/").pop()?.split("?")[0] || "";
                  documentName = decodeURIComponent(pathPart) || "contract.pdf";
                } catch {
                  documentName = "contract.pdf";
                }

                console.log(
                  "[ContractCron] ✓ Downloaded:",
                  documentName,
                  Math.round(arrayBuffer.byteLength / 1024),
                  "KB"
                );

                contractFromUrl = true;

                await supabase
                  .from("contract_review_inbox")
                  .update({ document_name: documentName, document_type: docType })
                  .eq("id", inboxRecord.id);

                break;
              } catch (dlErr) {
                console.log("[ContractCron] Download failed:", dlErr.message, "— trying next");
              }
            }
          }

          // SharePoint fallback — strip Graph Authorization
          // header and retry without it
          if (!base64Content) {
            const spCandidate = docLinks.find(
              (d) =>
                d.url.toLowerCase().includes("sharepoint.com") ||
                d.url.toLowerCase().includes("1drv.ms"),
            );
            if (spCandidate) {
              try {
                const spUrl = normalizeDocUrl(spCandidate.url);
                console.log(
                  "[ContractCron] SharePoint fallback (no auth):",
                  spUrl.slice(0, 100),
                );
                const spRes = await fetch(spUrl, {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  },
                  redirect: "follow",
                  signal: AbortSignal.timeout(20000),
                });
                if (spRes.ok) {
                  const ct = spRes.headers.get("content-type") || "";
                  const ab = await spRes.arrayBuffer();
                  if (ab.byteLength > 10000) {
                    base64Content = Buffer.from(ab).toString("base64");
                    docType = ct.includes("wordprocessingml") ? "docx" : "pdf";
                    console.log(
                      "[ContractCron] SharePoint fallback succeeded:",
                      ab.byteLength,
                      "bytes",
                    );
                  }
                }
              } catch (spErr) {
                console.log("[ContractCron] SharePoint fallback failed:", spErr.message);
              }
            }
          }

          if (!base64Content) {
            console.log("[ContractCron] All download attempts failed for Kenthurst");

            await supabase
              .from("contract_review_inbox")
              .update({
                status: "failed",
                error_message:
                  "Found " +
                  uniqueLinks.length +
                  " links in email chain but none could be downloaded. Links require login or are expired.",
                updated_at: new Date().toISOString(),
              })
              .eq("id", inboxRecord.id);

            await sendFailureEmail(
              accessToken,
              `Could not download contract — ${email.subject}`,
              `Found ${uniqueLinks.length} links in the email chain but could not download the contract.\n\n` +
                `The links appear to be from a real estate agent portal (agentbox) that requires login.\n\n` +
                `Please download the contract PDF manually from the agent portal and ` +
                `forward it as an email attachment to contractreview@conveyancingcrew.com.au`
            );
            results.skipped++;
            continue;
          }
        }

        if (!contractFromUrl && contractAtt) {
          const graphUserSource = encodeURIComponent(sourceMailbox);
          const contentAttRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${graphUserSource}/messages/${sourceEmailId}/attachments/${contractAtt.id}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const contentAttData = await contentAttRes.json();
          base64Content = contentAttData.contentBytes;

          if (!base64Content) {
            throw new Error("Could not extract attachment content from " + sourceMailbox);
          }
        }

        if (!base64Content) {
          throw new Error("No contract file bytes available for review");
        }

        console.log("[ContractCron] Processing:", email.subject, "|", documentName, "| source:", sourceMailbox);

        await supabase
          .from("contract_review_inbox")
          .update({
            status: "processing",
            document_name: documentName,
            document_type: docType,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inboxRecord.id);

        console.log(
          "[ContractCron] Processing:",
          email.subject,
          "| Doc:",
          documentName,
          "| Record ID:",
          inboxRecord.id
        );

        if (!process.env.ANTHROPIC_API_KEY) {
          throw new Error("ANTHROPIC_API_KEY is not configured");
        }

        const pdfBuffer = Buffer.from(base64Content, "base64");

        console.log(
          "[ContractCron] Running contract review directly...",
          Math.round(pdfBuffer.length / 1024),
          "KB"
        );

        let matterContext =
          `Contract received via email from ${email.from?.emailAddress?.name || ""} ` +
          `<${email.from?.emailAddress?.address || ""}>. ` +
          `Subject: ${email.subject}. Document: ${documentName}`;
        if (isForwarded) {
          matterContext += ` Original email subject (Gitu inbox): ${originalEmailSubject || "—"}.`;
        }

        const reviewResult =
          docType === "docx"
            ? await runDocxContractReview(pdfBuffer, matterContext)
            : await runContractReviewEngine(pdfBuffer, matterContext);

        console.log(
          "[ContractCron] Review complete for:",
          email.subject,
          "| Risk:",
          reviewResult.overallRiskLevel,
          "| Flags:",
          reviewResult.redFlags?.length || 0
        );

        console.log(
          "[ContractCron] Review cost:",
          reviewResult._reviewCost?.cost_aud != null
            ? `AUD $${reviewResult._reviewCost.cost_aud}`
            : "unknown"
        );

        const { error: reviewSaveErr } = await supabase
          .from("contract_review_inbox")
          .update({
            status: "complete",
            review_result: reviewResult,
            review_cost_aud: reviewResult._reviewCost?.cost_aud ?? null,
            review_cost_usd: reviewResult._reviewCost?.cost_usd ?? null,
            tokens_used: reviewResult._reviewCost?.total_tokens ?? null,
            is_read: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inboxRecord.id);

        if (!reviewSaveErr) {
          await linkOrCreateMatterFromContractReview(supabase, reviewResult, inboxRecord.id, email.id);
        } else {
          console.error("[ContractCron] contract_review_inbox update failed:", reviewSaveErr);
        }

        await sendReviewResultEmail(accessToken, email, documentName, reviewResult);

        results.processed++;
        console.log("[ContractCron] ✓ Completed:", email.subject);
      } catch (err) {
        console.error("[ContractCron] Failed processing email:", email?.id, email?.subject, err.message, err.stack);
        results.failed++;

        if (inboxRecord?.id) {
          await supabase
            .from("contract_review_inbox")
            .update({
              status: "failed",
              error_message: err.message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", inboxRecord.id);
        }

        try {
          const graphUserNotify = encodeURIComponent(CONTRACTS_MAILBOX);
          await fetch(`https://graph.microsoft.com/v1.0/users/${graphUserNotify}/sendMail`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                subject: `⚠ Contract Review Failed: ${email.subject}`,
                body: {
                  contentType: "HTML",
                  content: `
                  <p>Hi Gitu,</p>
                  <p>Contract review failed for: <strong>${String(email.subject || "").replace(/</g, "&lt;")}</strong></p>
                  <p><strong>Document:</strong> ${documentName || "Unknown"}</p>
                  <p><strong>Error:</strong> ${String(err.message || "").replace(/</g, "&lt;")}</p>
                  <p>Please review manually in the app.</p>
                  <p>Conveyancing Crew · AI Contract Review</p>
                `,
                },
                toRecipients: [{ emailAddress: { address: GITU_NOTIFY_EMAIL } }],
              },
            }),
          });
        } catch (emailErr) {
          console.error("[ContractCron] Failed to send failure notification:", emailErr.message);
        }
      }
    }

    console.log("[ContractCron] Run complete:", results);
    return NextResponse.json({ success: true, ...results });
  } catch (err) {
    console.error("[ContractCron] Fatal error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
