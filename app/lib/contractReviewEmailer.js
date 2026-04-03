/**
 * Shared contract review email sender.
 * Used by both the cron email inbox flow and the direct app upload flow.
 */

const CONTRACTS_MAILBOX = "contractreview@conveyancingcrew.com.au";
const GITU_NOTIFY_EMAIL = "gitu@conveyancingcrew.com.au";

async function getMsGraphToken() {
  const tenantId = process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID;
  const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MS Graph token error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

/**
 * Build and send the contract review result email to Gitu.
 *
 * @param {string} documentName  - filename shown in the email header
 * @param {object} r             - review result from contractReviewEngine
 * @param {string} [submittedBy] - e.g. "Uploaded via App" or "Forwarded email"
 */
export async function sendContractReviewEmail(documentName, r, submittedBy = "Uploaded via Conveyancing Crew App") {
  const accessToken = await getMsGraphToken();

  const riskColors = { LOW: "#16a34a", MEDIUM: "#ca8a04", HIGH: "#dc2626", CRITICAL: "#7f1d1d" };
  const riskBg    = { LOW: "#f0fdf4", MEDIUM: "#fffbeb", HIGH: "#fef2f2", CRITICAL: "#fff1f2" };
  const riskEmoji = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴", CRITICAL: "🚨" };
  const risk = String(r.overallRiskLevel || "MEDIUM").toUpperCase();

  const statusColor = { OK: "#16a34a", REVIEW: "#245eb0", WARNING: "#ca8a04", CRITICAL: "#dc2626" };
  const statusBg    = { OK: "#f0fdf4", REVIEW: "#e8f0fb", WARNING: "#fffbeb", CRITICAL: "#fef2f2" };
  const statusLabel = { OK: "✓ OK", REVIEW: "👁 Review", WARNING: "⚠ Warning", CRITICAL: "🚨 Critical" };

  const sectionIcon = {
    contractTerms: "📋", titleOwnership: "📍", zoningPlanning: "🏡",
    councilCertificates: "💧", specialConditions: "⚖️", inclusionsExclusions: "🔒",
    strataDetails: "🏢", adjustments: "💰", disclosures: "🚨",
  };
  const sectionName = {
    contractTerms: "Contract Terms", titleOwnership: "Title & Ownership",
    zoningPlanning: "Zoning & Planning", councilCertificates: "Council Certificates",
    specialConditions: "Special Conditions", inclusionsExclusions: "Inclusions & Exclusions",
    strataDetails: "Strata Details", adjustments: "Adjustments & Settlement",
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
    return (order[String(a.severity || "").toUpperCase()] ?? 9) - (order[String(b.severity || "").toUpperCase()] ?? 9);
  });

  const flagColors = { CRITICAL: "#dc2626", HIGH: "#ea580c", MEDIUM: "#ca8a04", LOW: "#94a3b8" };
  const flagBg     = { CRITICAL: "#fef2f2", HIGH: "#fff7ed", MEDIUM: "#fffbeb", LOW: "#f8fafc" };

  const redFlagsHtml = sortedFlags.length > 0
    ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;padding-bottom:8px;margin:24px 0 12px;">
      🚨 Red Flags (${sortedFlags.length} found)
    </h3>
    ${sortedFlags.map((f) => {
      const sev = String(f.severity || "").toUpperCase();
      return `
      <div style="border-left:4px solid ${flagColors[sev] || "#94a3b8"};
        background:${flagBg[sev] || "#f8fafc"};border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;
            background:${flagColors[sev] || "#94a3b8"};color:white;font-family:monospace;">
            ${f.severity}
          </span>
          <span style="font-size:11px;color:#6b7a99;font-family:monospace;">
            ${f.area || ""}${f.clauseReference ? ` · ${f.clauseReference}` : ""}
          </span>
        </div>
        <div style="font-size:13px;font-weight:600;color:#1a2744;margin-bottom:6px;">${f.issue || ""}</div>
        <div style="font-size:12px;color:#245eb0;background:#e8f0fb;padding:6px 10px;border-radius:5px;">
          💡 ${f.recommendation || ""}
        </div>
      </div>`;
    }).join("")}`
    : `<div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;color:#16a34a;font-weight:600;margin-bottom:20px;">
      ✓ No major red flags identified
    </div>`;

  const sectionsHtml = Object.entries(r.sections || {}).map(([key, section]) => {
    if (!section) return "";
    const status = String(section.status || "OK").toUpperCase();
    const details = section.details || [];
    const concerns = section.concerns || [];
    const easements = section.easements || [];
    const encumbrances = section.encumbrances || [];
    const overlays = section.overlays || [];
    const detailLine = (d) =>
      `<li style="font-size:11px;color:#6b7a99;margin-bottom:3px;line-height:1.5;">${typeof d === "string" ? d : String(d)}</li>`;

    return `
      <div style="border:1px solid #dce3f0;border-radius:8px;margin-bottom:10px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #dce3f0;">
          <span style="font-size:16px;">${sectionIcon[key] || "📄"}</span>
          <span style="font-size:13px;font-weight:700;color:#1a2744;flex:1;">${sectionName[key] || key}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;font-family:monospace;
            background:${statusBg[status] || "#f8fafc"};color:${statusColor[status] || "#6b7a99"};">
            ${statusLabel[status] || status}
          </span>
        </div>
        <div style="padding:12px 14px;">
          ${section.summary ? `<div style="font-size:12px;color:#374151;margin-bottom:8px;line-height:1.6;">${section.summary}</div>` : ""}
          ${details.length > 0 ? `<ul style="margin:0 0 8px;padding-left:18px;">${details.map(detailLine).join("")}</ul>` : ""}
          ${[...concerns, ...easements, ...encumbrances, ...overlays].length > 0 ? `
            <div style="background:#fffbeb;border-left:3px solid #ca8a04;padding:8px 10px;border-radius:0 5px 5px 0;margin-top:6px;">
              ${[...concerns, ...easements, ...encumbrances, ...overlays].map((c) =>
                `<div style="font-size:11px;color:#92400e;margin-bottom:2px;">⚠ ${typeof c === "string" ? c : String(c)}</div>`
              ).join("")}
            </div>` : ""}
          ${key === "strataDetails" && section.applicable ? `
            <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
              ${section.levies ? `<div style="background:#f8fafc;padding:6px 10px;border-radius:5px;"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Levies</div><div style="font-size:12px;font-weight:600;color:#1a2744;">${section.levies}</div></div>` : ""}
              ${section.sinkingFund ? `<div style="background:#f8fafc;padding:6px 10px;border-radius:5px;"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Sinking Fund</div><div style="font-size:12px;font-weight:600;color:#1a2744;">${section.sinkingFund}</div></div>` : ""}
              ${section.specialLevies ? `<div style="background:#fef2f2;padding:6px 10px;border-radius:5px;"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase;">Special Levies</div><div style="font-size:12px;font-weight:600;color:#dc2626;">${section.specialLevies}</div></div>` : ""}
            </div>` : ""}
        </div>
      </div>`;
  }).join("");

  const actionsHtml = (r.recommendedActions || []).length > 0
    ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;padding-bottom:8px;margin:24px 0 12px;">
      ✅ Recommended Actions
    </h3>
    ${r.recommendedActions.map((a) => {
      const priorityColor = { URGENT: "#dc2626", HIGH: "#ea580c", MEDIUM: "#ca8a04", LOW: "#16a34a" };
      const pr = String(a.priority || "").toUpperCase();
      return `
        <div style="display:flex;gap:10px;padding:8px 12px;border-radius:6px;background:#f8fafc;
          margin-bottom:6px;border-left:3px solid ${priorityColor[pr] || "#94a3b8"};">
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;
            background:${priorityColor[pr] || "#94a3b8"};color:white;height:fit-content;
            white-space:nowrap;font-family:monospace;">${a.priority}</span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#1a2744;">${a.action}</div>
            ${a.deadline ? `<div style="font-size:10px;color:#6b7a99;margin-top:2px;">⏰ ${a.deadline}</div>` : ""}
          </div>
        </div>`;
    }).join("")}` : "";

  const negotiationHtml = (r.negotiationPoints || []).length > 0
    ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;padding-bottom:8px;margin:24px 0 12px;">
      💬 Negotiation Points
    </h3>
    <ul style="margin:0;padding-left:20px;">
      ${r.negotiationPoints.map((p) => `<li style="font-size:12px;color:#374151;margin-bottom:6px;line-height:1.6;">${p}</li>`).join("")}
    </ul>` : "";

  const clientLetterHtml = r.clientLetter
    ? `
    <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;padding-bottom:8px;margin:24px 0 12px;">
      ✉️ Draft Client Letter
    </h3>
    <div style="background:#f8fafc;border:1px solid #dce3f0;border-radius:8px;padding:16px 20px;
      font-size:12px;color:#374151;line-height:1.8;white-space:pre-wrap;">${r.clientLetter}</div>` : "";

  const emailBody = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:750px;margin:0 auto;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a2744,#2d3f6b);color:white;padding:24px 28px;border-radius:10px 10px 0 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h2 style="margin:0;font-size:20px;font-weight:800;">✦ Contract Review Complete</h2>
            <div style="margin:4px 0 0;opacity:0.7;font-size:12px;">Conveyancing Crew — AI Contract Review</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px;opacity:0.6;text-transform:uppercase;letter-spacing:1px;">Document</div>
            <div style="font-size:12px;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${documentName}
            </div>
          </div>
        </div>
      </div>

      <div style="background:white;padding:24px 28px;border:1px solid #dce3f0;border-top:none;">

        <!-- Submitted via -->
        <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f0f0f0;">
          Submitted via: <strong style="color:#6b7a99;">${submittedBy}</strong> ·
          ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>

        <!-- Property address -->
        ${r.propertyAddress ? `
          <div style="font-size:18px;font-weight:800;color:#1a2744;margin-bottom:16px;">
            📍 ${r.propertyAddress}
          </div>` : ""}

        <!-- Key details bar -->
        ${keyDetailsHtml}

        <!-- Risk badge + summary -->
        ${riskBadgeHtml}

        <div style="font-size:13px;color:#374151;line-height:1.7;margin-bottom:20px;padding:14px 16px;
          background:#f8fafc;border-radius:8px;border-left:3px solid #245eb0;">
          ${r.overallSummary || ""}
        </div>

        <!-- Red flags -->
        ${redFlagsHtml}

        <!-- Recommended actions -->
        ${actionsHtml}

        <!-- Negotiation points -->
        ${negotiationHtml}

        <!-- Full sections report -->
        <h3 style="color:#1a2744;font-size:14px;border-bottom:2px solid #eee;padding-bottom:8px;margin:24px 0 12px;">
          📊 Full Report — All Sections
        </h3>
        ${sectionsHtml}

        <!-- Client letter -->
        ${clientLetterHtml}

        <!-- App link -->
        <div style="background:#f0f7ff;border:1px solid #bdd6f5;border-radius:8px;padding:16px;margin-top:24px;">
          <p style="margin:0;font-size:13px;color:#1a2744;">
            <strong>📱 View and action this review in the Conveyancing Crew app</strong><br>
            <span style="color:#666;font-size:12px;">Log in → Bell icon → Contract Reviews → Link to matter or create new matter</span>
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:#f8f9fa;padding:12px 28px;text-align:center;font-size:10px;color:#999;
        border-radius:0 0 10px 10px;border:1px solid #dce3f0;border-top:none;">
        ${r._reviewCost ? `
        <div style="margin-bottom:12px;padding:10px 14px;text-align:left;background:#f0fdf4;
          border:1px solid #bbf7d0;border-radius:6px;font-size:11px;color:#15803d;">
          💰 AI Review Cost: <strong>AUD $${(typeof r._reviewCost.cost_aud === "number" ? r._reviewCost.cost_aud : 0).toFixed(2)}</strong>
          · ${(r._reviewCost.total_tokens ?? 0).toLocaleString()} tokens
          · ${r._reviewCost.pages_reviewed ?? 0} pages
        </div>` : ""}
        Conveyancing Crew · AI Contract Review ·
        Sent to ${GITU_NOTIFY_EMAIL} ·
        ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>`;

  const subject = `✦ Contract Review: ${r.propertyAddress || documentName} — ${riskEmoji[risk] || riskEmoji.MEDIUM} ${risk} RISK · ${r.redFlags?.length || 0} red flags`;

  const graphUser = encodeURIComponent(CONTRACTS_MAILBOX);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${graphUser}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: emailBody },
        toRecipients: [{ emailAddress: { address: GITU_NOTIFY_EMAIL } }],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`sendMail failed: ${res.status} ${err}`);
  }

  console.log("[ContractReviewEmailer] Review email sent to", GITU_NOTIFY_EMAIL, "| doc:", documentName);
}
