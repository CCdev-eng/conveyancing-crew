"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// ─── DATA ──────────────────────────────────────────────────────────────────────
// MATTERS, tasks, contacts, calendarEvents etc. are loaded from Supabase via useState + useEffect.

const firmYTD_data = [];

const AI_CANNED = {
  "today": { text:"Here's your day at a glance:", bullets:["Critical tasks and upcoming settlements","Emails needing a response today","Overdue searches — follow up council & water","Referral fees to pay — protect your referral channels"] },
  "email": { text:"Here's a draft response:", bullets:["Draft text based on your matter and email context. Edit as needed before sending."] },
  "urgent": { text:"Matters requiring immediate attention:", bullets:["PEXA workspaces not created — create before settlement","Overdue searches — finance condition at risk","Outstanding certificates — special conditions at risk"] },
  "revenue": { text:"Financial summary for your active pipeline:", bullets:["Total active pipeline value","YTD revenue recognised","Outstanding invoices","Top clients by value"] },
  "default": { text:"I can help you with your practice. Try:", bullets:["\"Summarise today's tasks\"","\"Draft an email\"","\"What matters are most urgent?\"","\"Show me revenue summary\""] },
};
const matchAI = q => {
  const l = q.toLowerCase();
  if (l.includes("summar")||l.includes("today")||l.includes("day")) return AI_CANNED["today"];
  if (l.includes("email")||l.includes("draft")||l.includes("write")) return AI_CANNED["email"];
  if (l.includes("urgent")||l.includes("risk")||l.includes("critical")) return AI_CANNED["urgent"];
  if (l.includes("revenue")||l.includes("money")||l.includes("financ")) return AI_CANNED["revenue"];
  return AI_CANNED["default"];
};

/** Format P&L currency the same way as Xero-style display (en-AU, 2 dp). */
function formatPlCurrency(value) {
  const n = parseFloat(String(value ?? "0").replace(/[^0-9.-]/g, "")) || 0;
  return (
    "$" +
    n.toLocaleString("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Parse Xero P&L: top-level Rows with Section "Income", "Less Operating Expenses", and Net Profit row.
 */
function parseXeroProfitAndLoss(report) {
  const rows = report?.Rows || [];

  const incomeSection = rows.find((r) => r.RowType === "Section" && r.Title === "Income");
  const totalIncomeRaw =
    incomeSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value ?? "0";

  const expensesSection = rows.find(
    (r) => r.RowType === "Section" && (r.Title || "").includes("Operating Expenses")
  );
  const totalExpensesRaw =
    expensesSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value ?? "0";

  const netProfitRow = rows
    .flatMap((r) => r.Rows || [])
    .find((r) => r.RowType === "Row" && r.Cells?.[0]?.Value === "Net Profit");
  const netProfitRaw = netProfitRow?.Cells?.[1]?.Value ?? "0";

  const toNum = (v) => parseFloat(String(v ?? "0").replace(/[^0-9.-]/g, "")) || 0;

  const incomeLineItems = (incomeSection?.Rows || [])
    .filter((r) => r.RowType === "Row")
    .map((r) => ({
      name: r.Cells?.[0]?.Value ?? "—",
      amount: r.Cells?.[1]?.Value ?? "0",
    }));

  const expenseLineItems = (expensesSection?.Rows || [])
    .filter((r) => r.RowType === "Row")
    .map((r) => ({
      name: r.Cells?.[0]?.Value ?? "—",
      amount: r.Cells?.[1]?.Value ?? "0",
    }));

  return {
    totalIncome: toNum(totalIncomeRaw),
    totalExpenses: toNum(totalExpensesRaw),
    netProfit: toNum(netProfitRaw),
    totalIncomeRaw,
    totalExpensesRaw,
    netProfitRaw,
    incomeLineItems,
    expenseLineItems,
  };
}

/** Income / expenses / profit for one P&L report (chart series point). */
function extractPlSeriesFromReport(report) {
  const rows = report?.Rows || [];
  const incomeSection = rows.find((r) => r.RowType === "Section" && r.Title === "Income");
  const income =
    parseFloat(
      String(incomeSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value ?? "0").replace(
        /[^0-9.-]/g,
        ""
      )
    ) || 0;
  const expSection = rows.find(
    (r) => r.RowType === "Section" && (r.Title || "").includes("Expenses")
  );
  const expenses = Math.abs(
    parseFloat(
      String(expSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value ?? "0").replace(
        /[^0-9.-]/g,
        ""
      )
    ) || 0
  );
  const netProfitRow = rows
    .flatMap((r) => r.Rows || [])
    .find((r) => r.RowType === "Row" && r.Cells?.[0]?.Value === "Net Profit");
  const profitFromRow = parseFloat(
    String(netProfitRow?.Cells?.[1]?.Value ?? "").replace(/[^0-9.-]/g, "")
  );
  const profit = Number.isFinite(profitFromRow) ? profitFromRow : income - expenses;
  return { income, expenses, profit };
}

const PIE_COLORS_EXPENSE = [
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#059669",
  "#d97706",
  "#2563eb",
  "#9333ea",
  "#0f766e",
  "#b45309",
  "#be185d",
  "#1d4ed8",
  "#15803d",
  "#c2410c",
  "#7e22ce",
  "#0e7490",
  "#92400e",
];

const PIE_COLORS_REVENUE = [
  "#1d4ed8",
  "#0891b2",
  "#0f766e",
  "#059669",
  "#16a34a",
  "#2563eb",
  "#0284c7",
  "#0369a1",
];

/** Donut pie chart for Accounting revenue / expense breakdown (inline SVG). */
function PieChart({ data, title, colors = PIE_COLORS_REVENUE, onSliceClick, compact = false }) {
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;

  const size = compact ? 150 : 180;
  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 180;
  const r = 70 * scale;
  const holeR = 40 * scale;

  let currentAngle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const pct = d.value / total;
    const startAngle = currentAngle;
    const endAngle = currentAngle + pct * 2 * Math.PI;
    currentAngle = endAngle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const hx1 = cx + holeR * Math.cos(startAngle);
    const hy1 = cy + holeR * Math.sin(startAngle);
    const hx2 = cx + holeR * Math.cos(endAngle);
    const hy2 = cy + holeR * Math.sin(endAngle);
    const largeArc = pct > 0.5 ? 1 : 0;

    const path = `M ${hx1} ${hy1} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${hx2} ${hy2} A ${holeR} ${holeR} 0 ${largeArc} 0 ${hx1} ${hy1} Z`;

    return { ...d, path, pct, color: colors[i % colors.length] };
  });

  return (
    <div
      className="pie-chart-card"
      style={{
        background: "var(--white)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        padding: compact ? "14px 12px" : "20px",
        boxShadow: "var(--shadow-sm)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: "var(--text)", marginBottom: compact ? 12 : 16 }}>{title}</div>
      <div
        className="pie-chart-inner"
        style={{
          display: "flex",
          gap: compact ? 14 : 20,
          alignItems: "center",
          flexDirection: compact ? "column" : "row",
          justifyContent: compact ? "flex-start" : undefined,
        }}
      >
        <div style={{ position: "relative", flexShrink: 0, maxWidth: "100%" }}>
          <svg width={size} height={size} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
            {slices.map((s, i) => (
              <path
                key={i}
                d={s.path}
                fill={s.color}
                opacity={hoveredSlice === i ? 1 : 0.8}
                style={{ cursor: onSliceClick ? "pointer" : "default", transition: "opacity 0.15s" }}
                onMouseEnter={() => setHoveredSlice(i)}
                onMouseLeave={() => setHoveredSlice(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSliceClick?.(s);
                }}
              />
            ))}
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-3)"
              fontFamily="var(--font-mono), monospace"
            >
              TOTAL
            </text>
            <text
              x={cx}
              y={cy + 10}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill="var(--text)"
              fontFamily="var(--font-mono), monospace"
            >
              ${(total / 1000).toFixed(1)}k
            </text>
          </svg>
          {hoveredSlice !== null && (
            <div
              style={{
                position: "absolute",
                ...(compact
                  ? {
                      top: "100%",
                      left: "50%",
                      transform: "translate(-50%, 8px)",
                    }
                  : {
                      top: "50%",
                      left: "110%",
                      transform: "translateY(-50%)",
                    }),
                background: "var(--ink)",
                color: "white",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 11,
                whiteSpace: "nowrap",
                boxShadow: "var(--shadow-lg)",
                zIndex: 10,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{slices[hoveredSlice]?.label}</div>
              <div>
                $
                {slices[hoveredSlice]?.value.toLocaleString("en-AU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div style={{ color: "rgba(255,255,255,0.5)" }}>{(slices[hoveredSlice]?.pct * 100).toFixed(1)}%</div>
            </div>
          )}
        </div>

        <div style={{ flex: compact ? undefined : 1, width: compact ? "100%" : undefined, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          {slices.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: onSliceClick ? "pointer" : "default",
                padding: "3px 0",
                opacity: hoveredSlice === null || hoveredSlice === i ? 1 : 0.4,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={() => setHoveredSlice(i)}
              onMouseLeave={() => setHoveredSlice(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSliceClick?.(s);
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.label}
                </div>
              </div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono), monospace", color: "var(--text-2)", flexShrink: 0 }}>
                {(s.pct * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </div>
      {onSliceClick ? (
        <div
          style={{
            fontSize: 9,
            color: "var(--text-3)",
            fontFamily: "var(--font-mono)",
            textAlign: "center",
            marginTop: 8,
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          Click any slice for transactions
        </div>
      ) : null}
    </div>
  );
}

const URGENCY_COLOR = { critical:"#dc2626", high:"#ea580c", medium:"#ca8a04", low:"#16a34a", none:"#94a3b8" };
const AVATAR_COLORS = [
  "linear-gradient(135deg, #0f766e 0%, #0e9488 100%)",
  "linear-gradient(135deg, #245eb0 0%, #1a4a9e 100%)",
  "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
  "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
  "linear-gradient(135deg, #ca8a04 0%, #b45309 100%)",
];

const cleanEmailBody = (html) => {
  if (!html) return '';
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  cleaned = cleaned.replace(/<html[^>]*>/gi, '').replace(/<\/html>/gi, '');
  cleaned = cleaned.replace(/<body[^>]*>/gi, '').replace(/<\/body>/gi, '');
  cleaned = cleaned.replace(/<img[^>]+src=["']cid:[^"']*["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]+src=["']["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/\[horizontal bar\]/gi, '');
  cleaned = cleaned.replace(/font-family:[^;"]*/gi, '');
  cleaned = cleaned.replace(/font-size:\s*(\d+)(px|pt)/gi, (match, size, unit) => {
    const px = unit === 'pt' ? Math.round(parseInt(size, 10) * 1.33) : parseInt(size, 10);
    return px > 14 ? 'font-size:13px' : match;
  });
  cleaned = `<div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.8;color:#3d4f7a;max-width:100%;overflow-x:hidden">${cleaned}</div>`;
  return cleaned;
};

// ─── WORKFLOWS ────────────────────────────────────────────────────────────────
const WORKFLOWS = {
  Purchase: [
    {
      id:"purchase-intro", phase:"Introduction", icon:"👋", color:"#0f766e", colorLight:"#f0faf9",
      time:"30–45 min", channel:"Phone call",
      steps:[
        { label:"Initial introduction call with purchaser", time:"30–45 min", tool:"Phone call" },
      ],
      branches:[
        { label:"Referrals", desc:"Real estate / accountant / broker / repeat / word of mouth", icon:"🤝" },
        { label:"Website / Google", desc:"Organic search, Google Ads", icon:"🌐" },
      ],
    },
    {
      id:"purchase-contract-review", phase:"Contract Review", icon:"📄", color:"#ca8a04", colorLight:"#fefce8",
      time:"1–2 hrs", channel:"Email / Phone",
      steps:[
        { label:"Receive & review contract of sale", time:"1–2 hrs", tool:"Email / InfoTrack" },
        { label:"Before exchange — Email, Real Estate, Auction", time:"30 min", tool:"Email" },
        { label:"After exchange — review conditions post-exchange", time:"30 min", tool:"Manual" },
      ],
    },
    {
      id:"purchase-pexa-kyc", phase:"PEXA & KYC", icon:"🔐", color:"#7c3aed", colorLight:"#f5f3ff",
      time:"30–40 min", channel:"PEXA + InfoTrack",
      steps:[
        { label:"Set up PEXA workspace", time:"20 min", tool:"PEXA" },
        { label:"KYC — Know Your Client verification", time:"10–15 min", tool:"InfoTrack / Manual" },
      ],
      branches:[
        { label:"InfoTrack — VOI, CAF, purchase dec form", time:"5–10 min", icon:"🔍" },
        { label:"Manual — Forms (CAF, FHB, cost agreements)", time:"5–10 min", icon:"✏️" },
      ],
    },
    {
      id:"purchase-exchange", phase:"Exchange", icon:"🤝", color:"#1d4ed8", colorLight:"#eff6ff",
      time:"1–2 hrs", channel:"Phone / Email / InfoTrack",
      steps:[
        { label:"Discussion, negotiation, exchange, requisitions, cooling off", time:"30 min", tool:"Manual" },
      ],
      branches:[
        { label:"Manual — Phone call", time:"1–2 hrs", icon:"📞" },
        { label:"Digital — Email + InfoTrack", time:"15 min", icon:"✉️" },
      ],
      after:[
        { label:"Unconditional exchange + deposit", time:"15 min", tool:"Real estate / vendor solicitor" },
        { label:"Secure exchange — InfoTrack", time:"15 min", tool:"InfoTrack" },
        { label:"Order searches (council, water, strata)", time:"10–15 min", tool:"InfoTrack / Manual" },
      ],
    },
    {
      id:"purchase-searches-stamp", phase:"Searches & Stamp Duty", icon:"🔍", color:"#9333ea", colorLight:"#fdf4ff",
      time:"20–30 min", channel:"InfoTrack + Manual",
      steps:[
        { label:"InfoTrack — Stamp duty forms", time:"10 min", tool:"InfoTrack" },
        { label:"PEXA — Transfer & GST forms", time:"10 min", tool:"PEXA" },
      ],
    },
    {
      id:"purchase-adjustments", phase:"Adjustments", icon:"⚖️", color:"#ea580c", colorLight:"#fff7ed",
      time:"15–30 min", channel:"Manual / PEXA",
      steps:[
        { label:"Calculate settlement adjustments", time:"15–30 min", tool:"Manual" },
      ],
      branches:[
        { label:"Manual — Agree figures", time:"1 min", icon:"📝" },
        { label:"PEXA — Upload adjustments to PEXA workspace", time:"5–15 min", icon:"💻" },
      ],
    },
    {
      id:"purchase-settlement", phase:"Settlement", icon:"🏠", color:"#16a34a", colorLight:"#f0fdf4",
      time:"15–20 min", channel:"PEXA",
      steps:[
        { label:"Settlement confirmation via PEXA", time:"15–20 min", tool:"PEXA" },
        { label:"Post settlement — notify client, file matter", time:"15 min", tool:"Phone / Email" },
      ],
    },
  ],

  Sale: [
    {
      id:"sale-intro", phase:"Introduction", icon:"👋", color:"#0f766e", colorLight:"#f0faf9",
      time:"30–45 min", channel:"Phone call",
      steps:[
        { label:"Initial introduction call with vendor", time:"30–45 min", tool:"Phone call" },
      ],
      branches:[
        { label:"Referrals", desc:"Real estate / broker / repeat / word of mouth", icon:"🤝" },
        { label:"Website / Google", desc:"Organic search, Google Ads", icon:"🌐" },
      ],
    },
    {
      id:"sale-details", phase:"Matter Details", icon:"📋", color:"#ca8a04", colorLight:"#fefce8",
      time:"15–30 min", channel:"Phone / Email",
      steps:[
        { label:"Gather vendor details, property info, agent details", time:"15–30 min", tool:"Phone / Email" },
      ],
    },
    {
      id:"sale-contract-prep", phase:"Contract Preparation", icon:"📄", color:"#1d4ed8", colorLight:"#eff6ff",
      time:"15–30 min", channel:"Phone / Email",
      steps:[
        { label:"Phone — Manual call to client", time:"Manual", tool:"Phone" },
        { label:"Email — Digital confirmation", time:"Digital", tool:"Email" },
        { label:"Order searches + collate contract (InfoTrack)", time:"15–30 min", tool:"InfoTrack" },
      ],
      branches:[
        { label:"Phone (manual)", time:"Manual", icon:"📞" },
        { label:"Email (digital)", time:"Digital", icon:"✉️" },
      ],
    },
    {
      id:"sale-negotiations", phase:"Negotiations & Exchange", icon:"🤝", color:"#7c3aed", colorLight:"#f5f3ff",
      time:"15–30 min", channel:"Address / Email",
      steps:[
        { label:"Negotiations, discussions, requisitions, cooling off", time:"15–30 min", tool:"Address / Email" },
      ],
    },
    {
      id:"sale-land-tax", phase:"Land Tax & Certificates", icon:"📑", color:"#9333ea", colorLight:"#fdf4ff",
      time:"10 min", channel:"InfoTrack + Client",
      steps:[
        { label:"Land tax clearance + FRGW certificates", time:"10 min", tool:"InfoTrack / Manual" },
      ],
      branches:[
        { label:"InfoTrack", time:"10 min", icon:"🔍" },
        { label:"Client", time:"10 min", icon:"👤" },
      ],
    },
    {
      id:"sale-adjustments", phase:"Adjustments", icon:"⚖️", color:"#ea580c", colorLight:"#fff7ed",
      time:"15–30 min", channel:"Manual / PEXA",
      steps:[
        { label:"Calculate and agree settlement figures", time:"15–30 min", tool:"Manual" },
      ],
      branches:[
        { label:"Manual — Agree figures", time:"1 min", icon:"📝" },
        { label:"PEXA — Upload to workspace", time:"5–15 min", icon:"💻" },
      ],
    },
    {
      id:"sale-settlement", phase:"Settlement", icon:"🏠", color:"#16a34a", colorLight:"#f0fdf4",
      time:"15–20 min", channel:"PEXA",
      steps:[
        { label:"Settlement via PEXA", time:"15–20 min", tool:"PEXA" },
        { label:"Post settlement — confirm with client, issue invoice", time:"15 min", tool:"Phone / Email" },
      ],
    },
  ],

  Lease: [
    {
      id:"lease-intro", phase:"Introduction", icon:"👋", color:"#0f766e", colorLight:"#f0faf9",
      time:"20–30 min", channel:"Phone call",
      steps:[{ label:"Initial call — understand property, parties, term, rent", time:"20–30 min", tool:"Phone call" }],
    },
    {
      id:"lease-details", phase:"Lease Details", icon:"📋", color:"#ca8a04", colorLight:"#fefce8",
      time:"15–30 min", channel:"Email / Manual",
      steps:[
        { label:"Gather landlord & tenant details", time:"15 min", tool:"Email" },
        { label:"Property details — address, type, fixtures", time:"10 min", tool:"Manual" },
        { label:"Confirm term, rent, bond, rent-free period", time:"10 min", tool:"Phone" },
      ],
    },
    {
      id:"lease-draft", phase:"Lease Preparation", icon:"📄", color:"#1d4ed8", colorLight:"#eff6ff",
      time:"30–45 min", channel:"Manual / AI Draft",
      steps:[
        { label:"Prepare lease agreement — standard residential/commercial", time:"30–45 min", tool:"Manual / AI" },
        { label:"Review special conditions, inclusions, outgoings", time:"15 min", tool:"Manual" },
        { label:"Stamp duty assessment if applicable", time:"10 min", tool:"OSR / Manual" },
      ],
    },
    {
      id:"lease-execution", phase:"Execution", icon:"✍️", color:"#7c3aed", colorLight:"#f5f3ff",
      time:"15–20 min", channel:"Email / DocuSign",
      steps:[
        { label:"Send lease to landlord & tenant for signing", time:"15 min", tool:"Email / DocuSign" },
        { label:"Collect signed copies & bond payment", time:"10 min", tool:"Email" },
      ],
    },
    {
      id:"lease-registration", phase:"Registration & Completion", icon:"🏠", color:"#16a34a", colorLight:"#f0fdf4",
      time:"15 min", channel:"LRS / Manual",
      steps:[
        { label:"Register lease if required (LRS)", time:"15 min", tool:"LRS" },
        { label:"Provide executed copies to all parties", time:"10 min", tool:"Email" },
        { label:"File matter & issue invoice", time:"10 min", tool:"Xero / Manual" },
      ],
    },
  ],

  "Contract Review": [
    {
      id:"cr-intro", phase:"Introduction", icon:"👋", color:"#0f766e", colorLight:"#f0faf9",
      time:"15–20 min", channel:"Phone / Email",
      steps:[{ label:"Receive client enquiry and contract documents", time:"15–20 min", tool:"Email / Phone" }],
    },
    {
      id:"cr-review", phase:"Contract Review", icon:"📄", color:"#ca8a04", colorLight:"#fefce8",
      time:"1–2 hrs", channel:"Manual / AI",
      steps:[
        { label:"Review contract — title, terms, conditions, easements", time:"1–2 hrs", tool:"Manual / AI" },
        { label:"Identify risks, special conditions, red flags", time:"30 min", tool:"Manual" },
        { label:"Check Section 32 / Vendor Statement if applicable", time:"20 min", tool:"Manual" },
      ],
    },
    {
      id:"cr-advice", phase:"Advice to Client", icon:"💬", color:"#1d4ed8", colorLight:"#eff6ff",
      time:"30 min", channel:"Phone / Email",
      steps:[
        { label:"Prepare written advice / summary for client", time:"20 min", tool:"Manual / AI" },
        { label:"Discuss findings — risks, recommendations, negotiation points", time:"30 min", tool:"Phone call" },
        { label:"Advise on special conditions, cooling-off rights", time:"15 min", tool:"Phone / Email" },
      ],
    },
    {
      id:"cr-complete", phase:"Completion", icon:"✅", color:"#16a34a", colorLight:"#f0fdf4",
      time:"15 min", channel:"Email",
      steps:[
        { label:"Send written advice letter to client", time:"15 min", tool:"Email" },
        { label:"File matter & issue invoice", time:"10 min", tool:"Xero / Manual" },
      ],
    },
  ],

  "General Enquiry": [
    {
      id:"ge-intake", phase:"Initial Enquiry", icon:"👋", color:"#0f766e", colorLight:"#f0faf9",
      time:"15–20 min", channel:"Phone / Email / Website",
      steps:[{ label:"Receive enquiry — understand nature of question", time:"15–20 min", tool:"Phone / Email" }],
    },
    {
      id:"ge-assess", phase:"Assessment", icon:"🔎", color:"#ca8a04", colorLight:"#fefce8",
      time:"15–30 min", channel:"Manual",
      steps:[
        { label:"Assess scope — can this be answered or does it require a full matter?", time:"15–30 min", tool:"Manual" },
        { label:"If requires matter — convert to Purchase / Sale / Lease", time:"10 min", tool:"Manual" },
      ],
    },
    {
      id:"ge-advice", phase:"Advice", icon:"💬", color:"#1d4ed8", colorLight:"#eff6ff",
      time:"20–30 min", channel:"Phone / Email",
      steps:[
        { label:"Provide verbal or written general legal advice", time:"20–30 min", tool:"Phone / Email / Manual" },
        { label:"Research if required — property law, stamp duty, PEXA etc.", time:"15–30 min", tool:"Manual / Online" },
      ],
    },
    {
      id:"ge-complete", phase:"Completion", icon:"✅", color:"#16a34a", colorLight:"#f0fdf4",
      time:"10 min", channel:"Email",
      steps:[
        { label:"Send written summary / advice email to client", time:"10 min", tool:"Email" },
        { label:"Issue invoice if billable", time:"5 min", tool:"Xero" },
        { label:"File matter", time:"5 min", tool:"Manual" },
      ],
    },
  ],
};
const STAGE_COLORS = { "Intake":"#94a3b8","Contract Review":"#ca8a04","Contract Sent":"#1d4ed8","Searches Ordered":"#9333ea","PEXA Ready":"#0f766e","Settled":"#16a34a" };
const CHANNEL_ICONS = { email:"✉️", whatsapp:"💬", sms:"📱" };
const INTAKE_STEPS = ["Source","AI Extract","Review","Confirm"];
const SOURCES = [
  {id:"email",icon:"📧",label:"Email",desc:"Paste or import"},
  {id:"whatsapp",icon:"💬",label:"WhatsApp",desc:"Message thread"},
  {id:"document",icon:"📎",label:"Document",desc:"Upload file"},
  {id:"voice",icon:"🎙️",label:"Voice Note",desc:"Transcribe audio"},
  {id:"scan",icon:"📷",label:"Scan / Photo",desc:"Camera capture"},
  {id:"manual",icon:"✏️",label:"Manual",desc:"Enter by hand"},
];
const fmt = d => d ? new Date(d).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}) : "—";

const SEARCH_TYPES_BY_MATTER = {
  NSW_Purchase: [
    { id: "title", name: "Title Search", provider: "InfoTrack", turnaround: "1–2 business days", desc: "Current title search for the property." },
    { id: "council", name: "Council Rates", provider: "InfoTrack", turnaround: "1–3 business days", desc: "Rates and charges certificate." },
    { id: "water", name: "Water/Sewer", provider: "InfoTrack", turnaround: "1–2 business days", desc: "Water and sewer search." },
    { id: "strata", name: "Strata Report", provider: "InfoTrack", turnaround: "2–5 business days", desc: "Strata search for units." },
    { id: "stamp", name: "Stamp Duty Assessment", provider: "InfoTrack", turnaround: "Same day", desc: "Stamp duty estimate/assessment." },
  ],
  VIC_Purchase: [
    { id: "title", name: "Title Search", provider: "InfoTrack", turnaround: "1–2 business days", desc: "Current title search for the property." },
    { id: "council", name: "Council Rates", provider: "InfoTrack", turnaround: "1–3 business days", desc: "Rates and charges certificate." },
    { id: "water", name: "Water/Sewer", provider: "InfoTrack", turnaround: "1–2 business days", desc: "Water and sewer search." },
    { id: "landtax", name: "Land Tax Clearance", provider: "Landata", turnaround: "2–5 business days", desc: "Land tax clearance certificate." },
    { id: "frgw", name: "FRGW Certificate", provider: "Landata", turnaround: "3–7 business days", desc: "Section 32 / FRGW certificate." },
  ],
  Sale: [
    { id: "title", name: "Title Search", provider: "InfoTrack", turnaround: "1–2 business days", desc: "Current title for contract." },
    { id: "landtax", name: "Land Tax Clearance", provider: "InfoTrack", turnaround: "2–5 business days", desc: "Land tax clearance for settlement." },
  ],
};

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#1a2744;
  --ink-2:#243360;
  --ink-3:#2d4080;
  --surface:#f4f6fb;
  --white:#ffffff;
  --border:#dde3f0;
  --border-2:#e8ecf5;
  --muted:#8a96b0;
  --text:#1a2744;
  --text-2:#3d4f7a;
  --text-3:#7b8db0;
  --gold:#245eb0;
  --gold-light:#eef3fb;
  --gold-dim:#82a7d4;
  --teal:#1a4a9e;
  --teal-light:#eef3fb;
  --red:#dc2626;
  --red-light:#fef2f2;
  --amber:#b45309;
  --amber-light:#fffbeb;
  --green:#16a34a;
  --green-light:#f0fdf4;
  --blue:#245eb0;
  --blue-light:#eef3fb;
  --purple:#5b21b6;
  --purple-light:#f5f3ff;
  --radius:10px;
  --radius-sm:6px;
  --radius-lg:16px;
  --shadow-sm:0 1px 3px rgba(26,39,68,0.08),0 1px 2px rgba(26,39,68,0.05);
  --shadow:0 4px 20px rgba(26,39,68,0.1);
  --shadow-lg:0 16px 48px rgba(26,39,68,0.15);
  --shadow-xl:0 24px 64px rgba(26,39,68,0.22);
  --font-display:'Fraunces',Georgia,serif;
  --font-body:'DM Sans',system-ui,sans-serif;
  --font-mono:'DM Mono',monospace;
}
body{font-family:var(--font-body);background:var(--surface);color:var(--text);overflow:hidden}

@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}
@keyframes toastFade{0%,70%{opacity:1}100%{opacity:0}}
.fade-up{animation:fadeUp 0.35s ease both}
.fade-up-1{animation:fadeUp 0.35s 0.05s ease both}
.fade-up-2{animation:fadeUp 0.35s 0.1s ease both}
.fade-up-3{animation:fadeUp 0.35s 0.15s ease both}

/* ── APP SHELL ── */
.app{display:flex;height:100vh;overflow:hidden;background:var(--surface)}

/* ── SIDEBAR ── */
.sidebar{width:228px;flex-shrink:0;background:var(--ink);display:flex;flex-direction:column;position:relative;overflow:hidden}
.sidebar::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 80%,rgba(36,94,176,0.12) 0%,transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(36,94,176,0.06) 0%,transparent 50%);pointer-events:none}
.sb-brand{padding:24px 20px 18px;border-bottom:1px solid rgba(255,255,255,0.06);position:relative;z-index:1}
.sb-logo{display:flex;align-items:center;gap:10px}
.sb-logo-mark{width:auto;height:32px;border-radius:0;background:none;box-shadow:none;display:flex;align-items:center}
.sb-logo-text{font-family:var(--font-display);font-size:16px;font-weight:500;color:#f5f0e8;letter-spacing:-0.2px}
.sb-logo-sub{font-size:9px;color:rgba(255,255,255,0.3);font-family:var(--font-mono);letter-spacing:1.5px;text-transform:uppercase;margin-top:1px}
.sb-nav{flex:1;padding:12px 10px;overflow-y:auto;position:relative;z-index:1}
.sb-nav::-webkit-scrollbar{width:0}
.sb-section{font-size:9px;font-family:var(--font-mono);color:rgba(255,255,255,0.2);letter-spacing:2px;text-transform:uppercase;padding:14px 10px 6px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:rgba(255,255,255,0.45);transition:all 0.15s;margin-bottom:2px;border:none;background:none;width:100%;text-align:left;font-family:var(--font-body);position:relative}
.sb-item:hover{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.8)}
.sb-item.active{background:var(--blue-light);color:var(--text);font-weight:600}
.sb-item.active::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:18px;background:#245eb0;border-radius:0 3px 3px 0;box-shadow:0 0 8px rgba(36,94,176,0.4)}
.sb-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0;opacity:0.7}
.sb-item.active .sb-icon{opacity:1}
.sb-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:20px;font-family:var(--font-mono)}
.sb-badge.gold{background:#245eb0;color:var(--white)}
.sb-footer{padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;position:relative;z-index:1}
.sb-avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--teal),#0e9488);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;box-shadow:0 2px 6px rgba(15,118,110,0.3)}
.sb-user-name{font-size:12px;font-weight:600;color:#e2e8f0}
.sb-user-role{font-size:9px;color:rgba(255,255,255,0.3);font-family:var(--font-mono)}
.sb-online{width:7px;height:7px;border-radius:50%;background:#22c55e;margin-left:auto;flex-shrink:0;animation:pulse 3s ease infinite;box-shadow:0 0 0 2px rgba(34,197,94,0.2)}

/* ── MAIN ── */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* ── TOPBAR ── */
.topbar{background:var(--white);border-bottom:1px solid var(--border);padding:0 24px;height:58px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;box-shadow:0 1px 0 var(--border)}
.tb-page{font-family:var(--font-display);font-size:18px;font-weight:500;color:var(--text);letter-spacing:-0.3px}
.tb-page-sub{font-size:11px;color:var(--muted);font-family:var(--font-mono)}
.tb-right{display:flex;align-items:center;gap:8px}
.tb-search{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 12px;width:220px;transition:all 0.15s}
.tb-search:focus-within{border-color:var(--gold-dim);background:var(--white);box-shadow:0 0 0 3px rgba(36,94,176,0.15)}
.tb-search input{border:none;background:none;font-size:12px;color:var(--text);outline:none;width:100%;font-family:var(--font-body)}
.tb-search input::placeholder{color:var(--text-3)}
.icon-btn{width:34px;height:34px;border-radius:var(--radius-sm);background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;position:relative;transition:all 0.15s}
.icon-btn:hover{background:var(--white);border-color:#82a7d4}
.icon-btn .dot{position:absolute;top:4px;right:4px;width:auto;min-width:14px;height:14px;background:var(--red);border-radius:20px;border:1.5px solid var(--white);font-size:8px;font-weight:700;color:white;font-family:var(--font-mono);display:flex;align-items:center;justify-content:center;padding:0 3px}
.btn-primary{background:var(--ink);color:var(--white);border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);transition:all 0.15s;display:flex;align-items:center;gap:6px}
.btn-primary:hover{background:var(--ink-2);box-shadow:var(--shadow)}
.btn-gold{background:linear-gradient(135deg,#245eb0 0%,#1a4a9e 100%);color:white;border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
.btn-gold:hover{box-shadow:0 4px 16px rgba(36,94,176,0.35);transform:translateY(-1px)}
.btn-gold:disabled{opacity:0.45;transform:none;box-shadow:none;cursor:not-allowed}
.btn-ghost{background:none;border:1px solid var(--border);color:var(--text-2);border-radius:var(--radius-sm);padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
.btn-ghost:hover{border-color:var(--ink);color:var(--ink)}

/* ── CONTENT ── */
.content{flex:1;overflow-y:auto;padding:24px}
.content::-webkit-scrollbar{width:5px}
.content::-webkit-scrollbar-track{background:transparent}
.content::-webkit-scrollbar-thumb{background:var(--border);border-radius:10px}

/* ── CARDS ── */
.card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-sm);transition:all 0.2s}
.card:hover{box-shadow:var(--shadow)}
.card-hdr{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--border-2)}
.card-title{font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:7px}
.card-sub{font-size:10px;color:var(--text-3);font-family:var(--font-mono)}

/* ── STAT CARDS ── */
.stat-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
.stat{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);padding:16px 18px;box-shadow:var(--shadow-sm);position:relative;overflow:hidden;transition:all 0.2s}
.stat:hover{box-shadow:var(--shadow);transform:translateY(-1px)}
.stat-label{font-size:10px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px}
.stat-value{font-family:var(--font-display);font-size:26px;font-weight:500;color:var(--text);margin-bottom:4px;letter-spacing:-0.5px}
.stat-sub{font-size:11px;color:var(--text-3)}
.stat-accent .stat-value{color:var(--teal)}
.stat-gold .stat-value{color:var(--gold)}
.stat-red .stat-value{color:var(--red)}

/* ── TAGS ── */
.tag{display:inline-flex;align-items:center;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap;font-family:var(--font-mono)}
.tag-teal{background:var(--teal-light);color:var(--teal)}
.tag-gold{background:#eef3fb;color:#245eb0;border:1px solid #82a7d4}
.tag-red{background:var(--red-light);color:var(--red)}
.tag-amber{background:var(--amber-light);color:var(--amber)}
.tag-green{background:var(--green-light);color:var(--green)}
.tag-gray{background:var(--surface);color:var(--text-3);border:1px solid var(--border)}
.tag-blue{background:var(--blue-light);color:var(--blue)}
.tag-purple{background:var(--purple-light);color:var(--purple)}
.tag-ink{background:var(--ink);color:rgba(255,255,255,0.8)}

/* ── FILTER BAR ── */
.filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.filter-btn{padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;border:1px solid var(--border);background:var(--white);color:var(--text-2);cursor:pointer;transition:all 0.15s;font-family:var(--font-body)}
.filter-btn:hover{border-color:var(--ink-3);color:var(--ink)}
.filter-btn.active{background:var(--ink);border-color:var(--ink);color:var(--white);font-weight:600}
.filter-sep{flex:1}

/* ── DASHBOARD GRID ── */
.dash-grid{display:grid;grid-template-columns:1fr 1fr 1fr 320px;grid-template-rows:auto auto auto;gap:16px}

/* Tasks */
.task-item{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-2)}
.task-item:last-child{border-bottom:none}
.task-check{width:17px;height:17px;border-radius:4px;border:2px solid var(--border);cursor:pointer;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
.task-check:hover{border-color:var(--teal)}
.task-check.done{background:var(--teal);border-color:var(--teal);color:#fff;font-size:9px}
.task-body{flex:1;min-width:0}
.task-text{font-size:12px;font-weight:500;color:var(--text);line-height:1.4;margin-bottom:2px}
.task-text.done-text{text-decoration:line-through;color:var(--text-3)}
.task-meta{font-size:10px;color:var(--text-3);font-family:var(--font-mono)}

/* Comms */
.comm-item{display:flex;gap:10px;padding:11px 16px;border-bottom:1px solid var(--border-2);cursor:pointer;transition:all 0.12s}
.comm-item:hover{background:var(--surface)}
.comm-item:last-child{border-bottom:none}
.comm-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0}
.comm-name{font-size:12px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px}
.comm-preview{font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;line-height:1.4}
.comm-time{font-size:10px;font-family:var(--font-mono);color:var(--text-3);white-space:nowrap}
.comm-unread-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);flex-shrink:0;margin-top:4px}
.unread-name{font-weight:700;color:var(--ink)}

/* Comms - three zones */
.comms-container{display:flex;flex-direction:column;overflow:hidden;background:var(--surface)}
.comms-two-col{display:flex;flex:1;min-height:0;overflow:hidden}
.comms-left-col{width:300px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;height:100%;background:var(--white);border-right:1px solid var(--border)}
.comms-right-col{flex:1;display:flex;flex-direction:column;overflow:hidden;height:100%;min-height:0;background:var(--white);border-left:1px solid var(--border)}
.comms-detail-thread{flex:1;overflow-y:auto;min-height:0;padding:20px}
.comms-compose-wrap{flex-shrink:0;border-top:2px solid #82a7d4;background:var(--white)}
.comms-compose-buttons{display:flex;gap:8px;align-items:center;padding:8px 20px 8px;background:var(--white)}
.comms-inbox-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border-2);flex-shrink:0}
.comms-inbox-tab{padding:5px 12px;font-size:11px;font-weight:500;border-radius:999px;border:none;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
.comms-inbox-tab.inactive{background:var(--surface);color:var(--text-2)}
.comms-inbox-tab.active{background:var(--ink);color:var(--white)}
.comms-ai-bar{background:var(--blue-light);border-left:3px solid #245eb0;padding:10px 16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;gap:10px;transition:background 0.15s}
.comms-ai-bar:hover{background:rgba(253,248,236,0.9)}
.comms-ai-expanded{overflow:hidden;transition:max-height 0.3s ease;background:var(--blue-light);padding:0 20px}
.comms-ai-expanded .comms-ai-expanded-inner{max-height:300px;overflow-y:auto}
.comms-email-list{flex:1;overflow-y:auto;background:var(--white);min-height:0}
.comms-email-row{padding:14px 20px;border-bottom:1px solid var(--border-2);cursor:pointer;display:flex;gap:12px;align-items:flex-start;transition:all 0.15s;position:relative}
.comms-email-row:hover{background:var(--surface)}
.comms-email-row.selected{background:var(--ink);color:var(--white);border-left:none}
.comms-email-row.selected:hover{background:var(--ink-2)}
.comms-email-row.selected .comms-row-muted{color:rgba(255,255,255,0.85)}
.comms-email-row.unread{border-left:3px solid #245eb0}
.comms-email-row.unread.selected{border-left:3px solid #82a7d4}
.comms-email-expanded{background:var(--white);border-bottom:2px solid #82a7d4;padding:20px 24px;animation:fadeUp 0.2s ease}
.comms-compose-bar{padding:10px 20px;background:var(--white);border-top:1px solid var(--border);flex-shrink:0}
.comms-compose-form{overflow:hidden;transition:max-height 0.3s ease;background:var(--white);padding:0 20px}
.comms-avatar-36{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.comms-summary-section{margin-bottom:12px}
.comms-summary-section:last-child{margin-bottom:0}
.comms-summary-label{font-size:9px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--text-2);display:flex;align-items:center;gap:6px;margin-bottom:6px}
.comms-summary-label::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--text-3)}
.comms-summary-label.overview-dot::before{background:var(--teal)}
.comms-summary-label.points-dot::before{background:var(--teal)}
.comms-summary-label.steps-dot::before{background:var(--gold)}
.comms-summary-label.urgency-dot::before{background:var(--amber)}
.comms-summary-content{font-size:13px;font-family:var(--font-body);line-height:1.7;color:var(--text)}
.comms-summary-list-teal{list-style:none;padding:0;margin:0}
.comms-summary-list-teal li{padding-left:16px;position:relative;margin-bottom:4px}
.comms-summary-list-teal li::before{content:'';position:absolute;left:0;top:0.65em;width:5px;height:5px;border-radius:50%;background:var(--teal)}
.comms-summary-list-gold{list-style:none;padding:0;margin:0;counter-reset:step}
.comms-summary-list-gold li{counter-increment:step;padding-left:22px;position:relative;margin-bottom:4px}
.comms-summary-list-gold li::before{content:counter(step);position:absolute;left:0;top:0;font-family:var(--font-display);font-size:12px;font-weight:600;color:#245eb0}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.comms-summary-shimmer{animation:shimmer 1.5s ease-in-out infinite;background:linear-gradient(90deg,var(--blue-light) 0%,rgba(130,167,212,0.4) 50%,var(--blue-light) 100%);background-size:200% 100%}
.comms-row-shimmer{height:56px;border-bottom:1px solid var(--border-2);background:linear-gradient(90deg,var(--surface) 0%,var(--white) 50%,var(--surface) 100%);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}

/* Settlements */
.settlement-item{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border-2)}
.settlement-item:last-child{border-bottom:none}
.settle-date{font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--text);min-width:40px}
.settle-client{font-size:12px;font-weight:500;color:var(--text);flex:1}
.settle-value{font-size:12px;font-weight:700;color:var(--teal);font-family:var(--font-mono)}

/* AI Panel */
.ai-panel{grid-row:1/4;background:var(--ink);border-radius:var(--radius-lg);display:flex;flex-direction:column;height:100%;overflow:hidden;position:relative;border:1px solid var(--ink-2);box-shadow:var(--shadow-lg)}
.ai-panel::before{content:'';position:absolute;top:0;left:0;right:0;height:200px;background:radial-gradient(ellipse at 50% 0%,rgba(36,94,176,0.12) 0%,transparent 70%);pointer-events:none}
.ai-panel-hdr{padding:20px 18px 14px;border-bottom:1px solid rgba(255,255,255,0.06);position:relative;z-index:1}
.ai-panel-title{font-size:11px;font-family:var(--font-mono);color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px}
.ai-model-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(36,94,176,0.15);border:1px solid rgba(36,94,176,0.25);border-radius:20px;padding:4px 10px;font-size:10px;font-weight:600;color:#82a7d4;font-family:var(--font-mono)}
.ai-dot{width:6px;height:6px;border-radius:50%;background:#245eb0;animation:pulse 2s ease infinite}
.ai-messages{flex:1;overflow-y:scroll;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:0;max-height:400px;}
.ai-messages::-webkit-scrollbar{width:0}
.ai-msg{display:flex;gap:8px;max-width:100%}
.ai-msg.user{flex-direction:row-reverse}
.ai-msg-avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.ai-msg-avatar.ai-av{background:linear-gradient(135deg,#245eb0,#1a4a9e);color:var(--white)}
.ai-msg-avatar.user-av{background:linear-gradient(135deg,var(--teal),#0e9488);color:#fff;font-size:8px}
.ai-bubble{padding:9px 12px;border-radius:10px;font-size:11px;line-height:1.65}
.ai-bubble.ai-b{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.75);border-radius:3px 10px 10px 10px}
.ai-bubble.user-b{background:rgba(36,94,176,0.18);border:1px solid rgba(36,94,176,0.25);color:#82a7d4;border-radius:10px 3px 10px 10px}
.ai-bullets{list-style:none;margin-top:6px}
.ai-bullets li{font-size:10px;padding:3px 0 3px 14px;position:relative;color:rgba(255,255,255,0.55);line-height:1.6;border-bottom:1px solid rgba(255,255,255,0.04)}
.ai-bullets li:last-child{border-bottom:none}
.ai-bullets li::before{content:'›';position:absolute;left:0;color:#245eb0;font-weight:700}
.ai-typing{display:flex;gap:3px;padding:4px 0}
.typing-dot{width:5px;height:5px;border-radius:50%;background:#245eb0;opacity:0.6;animation:bounce 1.4s ease infinite}
.typing-dot:nth-child(2){animation-delay:0.2s}
.typing-dot:nth-child(3){animation-delay:0.4s}
.ai-input-area{padding:12px 14px;border-top:1px solid rgba(255,255,255,0.06)}
.ai-quick-prompts{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.ai-qp{font-size:10px;color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:5px 9px;cursor:pointer;font-family:var(--font-body);text-align:left;transition:all 0.12s}
.ai-qp:hover{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);border-color:rgba(201,168,76,0.2)}
.ai-input-row{display:flex;gap:6px}
.ai-input{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:7px;padding:8px 11px;font-size:11px;color:rgba(255,255,255,0.8);outline:none;font-family:var(--font-body);transition:all 0.15s}
.ai-input:focus{border-color:rgba(201,168,76,0.4);background:rgba(255,255,255,0.08)}
.ai-input::placeholder{color:rgba(255,255,255,0.2)}
.ai-send{background:linear-gradient(135deg,#245eb0,#1a4a9e);color:white;border:none;border-radius:7px;padding:8px 14px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
.ai-send:hover{box-shadow:0 2px 8px rgba(201,168,76,0.3)}

/* Financial */
.fin-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-2);font-size:12px;gap:8px}
.fin-row:last-child{border-bottom:none}
.fin-label{color:var(--text-2)}
.fin-val{font-weight:700;color:var(--text);font-family:var(--font-mono)}

/* Quick actions */
.quick-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.qa-btn{display:flex;align-items:center;gap:7px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;font-weight:500;color:var(--text);cursor:pointer;transition:all 0.15s;font-family:var(--font-body)}
.qa-btn:hover{border-color:var(--ink-3);color:var(--ink);box-shadow:var(--shadow-sm);transform:translateY(-1px)}
.qa-icon{font-size:14px}
.qa-btn.qa-primary{background:var(--ink);color:var(--white);border-color:var(--ink)}
.qa-btn.qa-primary:hover{background:var(--ink-2)}

/* ── DASHBOARD REDESIGN ── */
.dash-hero{background:linear-gradient(135deg,var(--ink) 0%,#1e3a6e 100%);padding:24px 28px;border-radius:var(--radius-lg);margin-bottom:20px;position:relative;overflow:hidden}
.dash-hero::before{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;background:radial-gradient(circle,rgba(36,94,176,0.3) 0%,transparent 70%);pointer-events:none}
.dash-hero::after{content:'';position:absolute;bottom:-30px;left:20%;width:300px;height:100px;background:radial-gradient(ellipse,rgba(36,94,176,0.15) 0%,transparent 70%);pointer-events:none}
.dash-greeting{font-family:var(--font-display);font-size:28px;font-weight:500;color:white;letter-spacing:-0.5px;margin-bottom:4px}
.dash-date{font-size:11px;font-family:var(--font-mono);color:rgba(255,255,255,0.4);margin-bottom:8px}
.dash-summary{font-size:13px;color:rgba(255,255,255,0.6);line-height:1.5}
.dash-hero-stats{display:flex;gap:32px;align-items:center}
.dash-hero-stat-val{font-family:var(--font-display);font-size:32px;font-weight:500;color:white;line-height:1;margin-bottom:4px}
.dash-hero-stat-label{font-size:9px;font-family:var(--font-mono);color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1.5px}
.dash-alerts{background:#fff8ed;border-bottom:3px solid var(--amber);border-radius:var(--radius);padding:10px 16px;margin-bottom:20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dash-alert-pill{display:flex;align-items:center;gap:8px;background:white;border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:11px;color:var(--text)}
.dash-main-grid{display:grid;grid-template-columns:1fr 1fr 380px;gap:20px;margin-bottom:20px}
.dash-bottom-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
.pipeline-stages{display:flex;flex-direction:column;gap:8px;padding:14px 18px}
.pipeline-stage-row{display:flex;align-items:center;gap:12px;cursor:pointer;padding:6px 8px;border-radius:8px;transition:background 0.12s}
.pipeline-stage-row:hover{background:var(--surface)}
.pipeline-stage-name{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px;width:110px;flex-shrink:0}
.pipeline-stage-count{font-family:var(--font-display);font-size:18px;font-weight:500;color:var(--text);width:28px;flex-shrink:0;text-align:right}
.pipeline-stage-bar-wrap{flex:1;height:6px;background:var(--surface);border-radius:10px;overflow:hidden}
.pipeline-stage-bar{height:100%;border-radius:10px;transition:width 0.5s ease}
.ai-brief-card{background:var(--ink);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px;position:relative;overflow:hidden}
.ai-brief-card::before{content:'';position:absolute;top:0;right:0;width:120px;height:120px;background:radial-gradient(circle,rgba(36,94,176,0.2) 0%,transparent 70%);pointer-events:none}
.ai-brief-label{font-size:9px;font-family:var(--font-mono);color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.ai-brief-text{font-size:13px;color:rgba(255,255,255,0.75);line-height:1.8;white-space:pre-wrap}
.mini-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.mini-cal-day{display:flex;flex-direction:column;align-items:center;padding:6px 2px;border-radius:8px;cursor:pointer;transition:background 0.12s}
.mini-cal-day:hover{background:var(--surface)}
.mini-cal-day.today{background:var(--blue-light)}
.mini-cal-day-name{font-size:8px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.mini-cal-day-num{font-size:13px;font-weight:600;color:var(--text);width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:4px}
.mini-cal-day.today .mini-cal-day-num{background:var(--blue);color:white}
.mini-cal-dots{display:flex;gap:2px;flex-wrap:wrap;justify-content:center;min-height:8px}
.mini-cal-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.dash-ai-messages{overflow-y:scroll;scrollbar-gutter:stable}
.dash-ai-messages::-webkit-scrollbar{width:8px}
.dash-ai-messages::-webkit-scrollbar-track{background:rgba(0,0,0,0.15);border-radius:10px}
.dash-ai-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.35);border-radius:10px}
.dash-ai-messages::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.5)}

/* ── MATTERS TABLE ── */
.matter-table{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)}
.mt-thead{display:grid;grid-template-columns:120px 1fr 130px 140px 90px 90px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--border);gap:12px}
.mt-th{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px}
.mt-row{display:grid;grid-template-columns:120px 1fr 130px 140px 90px 90px;padding:13px 20px;border-bottom:1px solid var(--border-2);gap:12px;align-items:center;cursor:pointer;transition:all 0.1s}
.mt-row:last-child{border-bottom:none}
.mt-row:hover{background:#fafaf9}
.mt-id{font-size:10px;font-family:var(--font-mono);color:var(--text-3)}
.mt-client{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px}
.mt-addr{font-size:10px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mt-stage{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-2)}
.stage-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}

/* ── MATTER WORKSPACE ── */
.workspace{display:flex;flex-direction:column;height:100%}
.ws-header{background:var(--white);border-bottom:1px solid var(--border);padding:16px 24px;flex-shrink:0}
.ws-matter-id{font-size:10px;font-family:var(--font-mono);color:var(--text-3);letter-spacing:1.5px;margin-bottom:4px}
.ws-client{font-family:var(--font-display);font-size:20px;font-weight:500;color:var(--text);margin-bottom:3px;letter-spacing:-0.3px}
.ws-address{font-size:12px;color:var(--text-2);margin-bottom:10px}
.ws-tabs{display:flex;gap:0}
.ws-tab{padding:9px 18px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:none;color:var(--text-3);font-family:var(--font-body);border-bottom:2px solid transparent;transition:all 0.15s;margin-right:2px}
.ws-tab:hover{color:var(--text)}
.ws-tab.active{color:var(--ink);font-weight:700;border-bottom-color:#245eb0}
.ws-content{flex:1;overflow-y:auto;padding:20px 24px}

/* Timeline */
.timeline-item{display:flex;gap:14px;margin-bottom:0;position:relative}
.timeline-item::before{content:'';position:absolute;left:14px;top:28px;width:2px;bottom:-12px;background:var(--border-2)}
.timeline-item:last-child::before{display:none}
.tl-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;position:relative;z-index:1;border:2px solid var(--white)}
.tl-body{flex:1;background:var(--white);border:1px solid var(--border-2);border-radius:var(--radius);padding:12px 14px;margin-bottom:12px;box-shadow:var(--shadow-sm)}
.tl-meta{font-size:10px;font-family:var(--font-mono);color:var(--text-3);margin-bottom:5px;display:flex;gap:8px;align-items:center}
.tl-title{font-size:12px;font-weight:600;color:var(--text);margin-bottom:3px}
.tl-text{font-size:12px;color:var(--text-2);line-height:1.6}

/* Doc items */
.doc-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--white);cursor:pointer;transition:all 0.15s}
.doc-item:hover{border-color:#82a7d4;background:var(--blue-light)}
.doc-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.doc-name{font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px}
.doc-meta{font-size:10px;font-family:var(--font-mono);color:var(--text-3)}

/* Billing */
.billing-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--border-2);gap:12px}
.billing-row:last-child{border-bottom:none}
.billing-id{font-size:10px;font-family:var(--font-mono);color:var(--text-3)}
.billing-amount{font-size:14px;font-weight:700;color:var(--text);font-family:var(--font-mono)}

/* ── COMMS PAGE ── */
.comms-layout{display:grid;grid-template-columns:280px 1fr 280px;gap:0;height:100%}
.comms-left{border-right:1px solid var(--border);overflow-y:auto;background:var(--white)}
.comms-main{display:flex;flex-direction:column;overflow:hidden}
.comms-thread{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px;background:var(--surface)}
.thread-msg{max-width:72%}
.thread-msg.incoming{align-self:flex-start}
.thread-msg.outgoing{align-self:flex-end}
.thread-bubble{padding:11px 14px;border-radius:12px;font-size:12px;line-height:1.65}
.thread-bubble.incoming{background:var(--white);border:1px solid var(--border);color:var(--text);border-radius:3px 12px 12px 12px;box-shadow:var(--shadow-sm)}
.thread-bubble.outgoing{background:var(--ink);color:rgba(255,255,255,0.9);border-radius:12px 3px 12px 12px}
.thread-meta{font-size:10px;font-family:var(--font-mono);color:var(--text-3);margin-bottom:5px}
.comms-compose{padding:14px 20px;border-top:1px solid var(--border);background:var(--white);flex-shrink:0}
.compose-textarea{width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-size:12px;font-family:var(--font-body);resize:none;outline:none;min-height:72px;color:var(--text);background:var(--surface);transition:all 0.15s}
.compose-textarea:focus{border-color:#82a7d4;background:var(--white);box-shadow:0 0 0 3px rgba(36,94,176,0.15)}
.ai-summary-card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);padding:14px 16px;margin-bottom:14px;box-shadow:var(--shadow-sm)}
.ai-sum-label{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
.ai-sum-item{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-2);font-size:11px;color:var(--text-2);line-height:1.5}
.ai-sum-item:last-child{border-bottom:none}
.ai-sum-dot{width:5px;height:5px;border-radius:50%;background:var(--teal);margin-top:5px;flex-shrink:0}
.comms-page{display:flex;height:calc(100vh - 58px);overflow:hidden}
.comms-page-left{display:flex;flex-direction:column;overflow:hidden;background:var(--white);border-right:1px solid var(--border)}
.comms-page-mid{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--surface);min-width:300px}
.comms-page-right{display:flex;flex-direction:column;overflow:hidden;background:var(--ink);border-left:1px solid rgba(255,255,255,0.06)}
.comms-page-divider{width:4px;background:var(--border-2);cursor:col-resize;flex-shrink:0;transition:background 0.15s}
.comms-page-divider:hover{background:var(--blue)}

/* ── REFERRALS ── */
.ref-layout{display:grid;grid-template-columns:290px 1fr;gap:16px;height:calc(100vh - 160px);overflow:hidden}
.ref-list{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow-y:auto;box-shadow:var(--shadow-sm)}
.ref-list-item{padding:14px 16px;border-bottom:1px solid var(--border-2);cursor:pointer;transition:all 0.15s;position:relative}
.ref-list-item:hover{background:var(--surface)}
.ref-list-item.active{background:var(--blue-light);border-right:3px solid #245eb0}
.rli-name{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px}
.rli-type{font-size:10px;font-family:var(--font-mono);color:var(--text-3);margin-bottom:6px}
.ref-detail{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow-y:auto;box-shadow:var(--shadow-sm)}
.rdt-header{padding:20px 22px 16px;border-bottom:1px solid var(--border-2)}
.rdt-name{font-family:var(--font-display);font-size:20px;font-weight:500;color:var(--text);margin-bottom:4px;letter-spacing:-0.3px}
.rdt-meta{font-size:12px;color:var(--text-3);margin-bottom:10px;font-family:var(--font-mono)}
.rdt-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.rdt-sum-card{background:var(--surface);border-radius:var(--radius);padding:12px 14px;border:1px solid var(--border-2)}
.rdt-sum-label{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
.rdt-sum-value{font-family:var(--font-display);font-size:20px;font-weight:500;color:var(--text)}
.fee-pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;font-family:var(--font-mono)}
.fee-paid{background:var(--green-light);color:var(--green)}
.fee-owed{background:var(--amber-light);color:var(--amber);border:1px solid #fde68a}
.fee-none{background:var(--surface);color:var(--text-3);border:1px solid var(--border)}

/* ── CONTACTS ── */
.contacts-layout{display:grid;grid-template-columns:320px 1fr;height:calc(100vh - 58px);overflow:hidden}
.contacts-list{background:var(--white);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.contacts-list-scroll{flex:1;overflow-y:auto}
.contact-card{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-2);cursor:pointer;transition:all 0.15s;position:relative}
.contact-card:hover{background:var(--surface);transform:translateY(-1px)}
.contact-card.selected{background:var(--gold-light);border-left:3px solid var(--gold)}
.contact-avatar-lg{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:white;flex-shrink:0}
.contact-detail{flex:1;overflow-y:auto;padding:24px;background:var(--surface)}
.contact-ai-card{background:var(--gold-light);border:1px solid var(--gold-dim);border-radius:var(--radius-lg);padding:20px;margin-bottom:20px}
.contact-matters-list{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow:hidden;margin-bottom:20px}
.contact-matter-row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border-2);cursor:pointer;transition:all 0.12s}
.contact-matter-row:hover{background:var(--surface)}
.contact-fields-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);padding:16px;margin-bottom:20px;width:100%}
.contact-fields-grid .contact-field{overflow:visible}
.contact-field{display:flex;flex-direction:column;gap:4px;max-width:100%;overflow:visible}
.contact-field-label{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px;max-width:100%}
.contact-field-value{font-size:13px;color:var(--text);font-weight:500;max-width:100%}

/* Contact list table (reuse matter-table) */
.contacts-table .mt-thead,.contacts-table .mt-row{grid-template-columns:minmax(180px,1.2fr) 90px 120px minmax(140px,1fr) 72px 44px}
.contacts-table .mt-row{cursor:default}

/* ── CALENDAR ── */
.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--border);width:100%}
.calendar-day-header{background:var(--surface);padding:8px;text-align:center;font-size:10px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px}
.calendar-day{background:var(--white);padding:6px;min-height:110px;cursor:pointer;transition:background 0.12s;vertical-align:top;overflow:hidden}
.calendar-day:hover{background:#f8faff}
.calendar-day.other-month{background:#fafafa}
.calendar-day.other-month .cal-day-num{color:var(--text-3)}
.calendar-day.today .cal-day-num{background:var(--blue);color:white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center}
.cal-day-num{font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center}
.cal-event-pill{font-size:10px;padding:2px 6px;border-radius:4px;margin-bottom:2px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:2px solid;transition:opacity 0.12s}
.cal-event-pill:hover{opacity:0.8}
.week-grid{display:grid;grid-template-columns:50px repeat(7,1fr);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.week-time-col{background:var(--surface);border-right:1px solid var(--border)}
.week-day-col{border-right:1px solid var(--border-2);min-height:600px;position:relative}
.week-day-col:last-child{border-right:none}
.week-day-header{padding:8px;text-align:center;background:var(--surface);border-bottom:1px solid var(--border);font-size:11px;font-weight:600}
.week-day-header.today{background:var(--blue-light);color:var(--blue)}

.contact-modal-overlay{position:fixed;inset:0;background:rgba(26,39,68,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px}
.contact-modal{width:95vw;max-width:1200px;height:90vh;background:var(--white);border-radius:20px;display:flex;flex-direction:column;box-shadow:var(--shadow-xl);overflow:hidden}
.contact-modal-hdr{padding:18px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;flex-shrink:0}
.contact-modal-body{flex:1;overflow:hidden;display:grid;grid-template-columns:280px 1fr 300px;min-height:0;height:100%}
.contact-modal-left{border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.contact-modal-mid{display:flex;flex-direction:column;overflow:hidden;height:100%;min-height:0;flex:1}
.contact-modal-right{border-left:1px solid var(--border);overflow-y:auto;min-height:0;height:100%;padding:16px;background:var(--white)}

/* ── ACCOUNTING ── */
.acc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.acc-stat{background:var(--white);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;box-shadow:var(--shadow-sm)}
.acc-stat-icon{font-size:20px;margin-bottom:8px}
.acc-stat-label{font-size:10px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
.acc-stat-val{font-family:var(--font-display);font-size:24px;font-weight:500;color:var(--text)}
.inv-row{display:grid;grid-template-columns:120px 1fr 120px 120px 90px 80px;padding:11px 20px;border-bottom:1px solid var(--border-2);gap:12px;align-items:center;font-size:12px}
.inv-thead{background:var(--surface);font-size:9px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px;color:var(--text-3);border-bottom:1px solid var(--border)}
.inv-id{font-family:var(--font-mono);font-size:10px;color:var(--text-3)}
.xero-badge{display:inline-flex;align-items:center;gap:5px;background:#1AB4D7;color:#fff;border-radius:5px;padding:3px 9px;font-size:9px;font-weight:700;font-family:var(--font-mono)}
.acc-period-toggle{display:flex;gap:4px;background:var(--surface);border-radius:20px;padding:3px;border:1px solid var(--border)}
.acc-period-btn{padding:5px 14px;border-radius:20px;font-size:11px;font-weight:500;border:none;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
.acc-period-btn.active{background:var(--ink);color:white}
.acc-period-btn:not(.active){background:none;color:var(--text-2)}
.acc-chart-card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);padding:20px;margin-bottom:20px;box-shadow:var(--shadow-sm)}
.acc-chart-wrap{position:relative;width:100%;overflow:visible}
.acc-chart-tooltip{position:absolute;background:var(--ink);color:white;border-radius:8px;padding:10px 14px;font-size:11px;pointer-events:none;z-index:10;box-shadow:var(--shadow-lg);min-width:140px}
.acc-breakdown-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border-2)}
.acc-breakdown-bar{height:4px;border-radius:10px;margin-top:4px}
.acc-ai-report{background:var(--ink);border-radius:var(--radius-lg);padding:24px;margin-top:20px;position:relative;overflow:hidden}
.acc-ai-report::before{content:'';position:absolute;top:0;right:0;width:150px;height:150px;background:radial-gradient(circle,rgba(36,94,176,0.2) 0%,transparent 70%);pointer-events:none}
@keyframes accChartFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.acc-chart-svg{animation:accChartFade 0.55s ease-out forwards}

/* ── INSIGHTS ── */
.insights-layout{display:grid;grid-template-columns:1fr 320px;gap:16px;height:100%}
.insights-main{overflow-y:auto}
.chart-wrap{background:var(--surface);border-radius:var(--radius);border:1px solid var(--border-2);height:140px;display:flex;align-items:flex-end;gap:6px;padding:12px 16px 28px}
.chart-bar{flex:1;border-radius:3px 3px 0 0;transition:all 0.3s;cursor:pointer;position:relative;min-height:4px}
.chart-bar:hover{filter:brightness(1.1)}
.chart-bar-label{position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:8px;font-family:var(--font-mono);color:var(--text-3);white-space:nowrap}

/* ── MODAL ── */
.modal-overlay{position:fixed;inset:0;background:rgba(13,15,26,0.72);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px)}
.intake-modal{background:var(--white);border-radius:20px;width:100%;max-width:700px;max-height:88vh;overflow-y:auto;box-shadow:var(--shadow-xl)}
.intake-hdr{padding:22px 26px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between}
.intake-title{font-family:var(--font-display);font-size:20px;font-weight:500;color:var(--text);margin-bottom:3px}
.intake-sub{font-size:12px;color:var(--text-3)}
.intake-stepper{display:flex;align-items:center;padding:16px 26px;border-bottom:1px solid var(--border)}
.is-step{display:flex;align-items:center;gap:7px}
.is-dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.is-dot.done{background:var(--teal);color:#fff}
.is-dot.curr{background:var(--ink);color:var(--white);box-shadow:0 0 0 3px rgba(36,94,176,0.15)}
.is-dot.todo{background:var(--surface);color:var(--text-3);border:2px solid var(--border)}
.is-label{font-size:11px;font-weight:500;color:var(--text-2)}
.is-label.curr{color:var(--ink);font-weight:700}
.is-line{flex:1;height:2px;background:var(--border);margin:0 8px}
.is-line.done{background:var(--teal)}
.intake-body{padding:22px 26px}
.intake-source-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
.src-card{padding:14px;border:2px solid var(--border);border-radius:var(--radius);cursor:pointer;text-align:center;transition:all 0.15s;background:var(--surface)}
.src-card:hover{border-color:#82a7d4;background:var(--blue-light)}
.src-card.sel{border-color:#245eb0;background:var(--blue-light)}
.src-icon{font-size:22px;margin-bottom:5px}
.src-label{font-size:11px;font-weight:600;color:var(--text)}
.src-desc{font-size:10px;color:var(--text-3);margin-top:2px}
.intake-label{font-size:10px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;display:block}
.intake-input{width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;font-family:var(--font-body);outline:none;color:var(--text);background:var(--surface);transition:all 0.15s}
.intake-input:focus{border-color:#82a7d4;background:var(--white);box-shadow:0 0 0 3px rgba(36,94,176,0.15)}
.intake-textarea{width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-size:12px;font-family:var(--font-body);resize:vertical;min-height:90px;outline:none;color:var(--text);background:var(--surface);transition:all 0.15s}
.intake-textarea:focus{border-color:#82a7d4;background:var(--white);box-shadow:0 0 0 3px rgba(36,94,176,0.15)}
.intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.intake-footer{padding:14px 26px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:0 0 20px 20px}
.extracted-card{background:var(--ink);border-radius:var(--radius-lg);padding:16px 18px;margin-bottom:14px;position:relative;overflow:hidden}
.extracted-card::before{content:'';position:absolute;top:0;right:0;width:80px;height:80px;background:radial-gradient(circle,rgba(36,94,176,0.15) 0%,transparent 70%);pointer-events:none}
.ext-badge{font-size:8px;font-family:var(--font-mono);background:rgba(36,94,176,0.2);border:1px solid rgba(36,94,176,0.3);color:#82a7d4;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;display:inline-block;margin-bottom:10px}
.ext-field{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;gap:8px}
.ext-field:last-child{border-bottom:none}
.ext-key{color:rgba(255,255,255,0.4);font-family:var(--font-mono)}
.ext-val{color:rgba(255,255,255,0.85);font-weight:600;text-align:right}
.ext-conf{font-size:8px;padding:1px 6px;border-radius:20px;font-family:var(--font-mono);font-weight:700}
.conf-hi{background:rgba(22,163,74,0.2);color:#86efac}
.conf-med{background:rgba(202,138,4,0.2);color:#fde047}
.missing-alert{display:flex;gap:8px;background:var(--amber-light);border-radius:8px;border-left:3px solid var(--amber);padding:8px 12px;margin-bottom:6px;font-size:11px;color:#78350f;line-height:1.5}
.modal-close{width:30px;height:30px;border-radius:7px;background:var(--surface);border:1px solid var(--border);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-3);transition:all 0.15s}
.modal-close:hover{background:var(--red-light);color:var(--red)}

/* ── WORKFLOW ── */
.wf-container{max-width:860px}
.wf-header{margin-bottom:24px}
.wf-title{font-family:var(--font-display);font-size:22px;font-weight:500;color:var(--text);margin-bottom:4px;letter-spacing:-0.3px}
.wf-subtitle{font-size:12px;color:var(--text-3);font-family:var(--font-mono)}
.wf-phase{position:relative;margin-bottom:0}
.wf-connector{display:flex;justify-content:center;height:32px;position:relative}
.wf-connector::before{content:'';position:absolute;left:50%;top:0;width:2px;height:100%;background:linear-gradient(to bottom,var(--border),var(--border-2));transform:translateX(-50%)}
.wf-connector-arrow{position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--border);line-height:1}
.wf-card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-sm);overflow:hidden;transition:all 0.2s}
.wf-card:hover{box-shadow:var(--shadow);transform:translateY(-1px)}
.wf-card-hdr{display:flex;align-items:center;gap:12px;padding:14px 18px 12px}
.wf-phase-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.wf-phase-name{font-size:14px;font-weight:700;color:var(--text)}
.wf-phase-meta{font-size:10px;color:var(--text-3);font-family:var(--font-mono);margin-top:1px}
.wf-phase-badge{margin-left:auto;flex-shrink:0}
.wf-steps{padding:0 18px 14px;border-top:1px solid var(--border-2)}
.wf-step{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-2)}
.wf-step:last-child{border-bottom:none}
.wf-step-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:5px}
.wf-step-label{font-size:12px;color:var(--text);flex:1;line-height:1.5}
.wf-step-meta{font-size:10px;color:var(--text-3);font-family:var(--font-mono);white-space:nowrap;margin-top:1px}
.wf-branches{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 18px;background:var(--surface);border-top:1px solid var(--border-2)}
.wf-branch{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;display:flex;gap:8px;align-items:flex-start}
.wf-branch-icon{font-size:16px;flex-shrink:0}
.wf-branch-label{font-size:11px;font-weight:600;color:var(--text);margin-bottom:2px}
.wf-branch-desc{font-size:10px;color:var(--text-3);line-height:1.4}
.wf-branch-time{font-size:9px;font-family:var(--font-mono);color:var(--text-3);margin-top:3px}
.wf-progress{display:flex;gap:0;margin-bottom:20px;background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)}
.wf-prog-step{flex:1;padding:10px 8px;text-align:center;cursor:pointer;transition:all 0.15s;border-right:1px solid var(--border);position:relative}
.wf-prog-step:last-child{border-right:none}
.wf-prog-step:hover{background:var(--surface)}
.wf-prog-step.current{background:var(--blue-light)}
.wf-prog-step.completed{background:var(--teal-light)}
.wf-prog-icon{font-size:16px;margin-bottom:3px}
.wf-prog-label{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;line-height:1.3}
.wf-prog-step.current .wf-prog-label{color:#245eb0;font-weight:700}
.wf-prog-step.completed .wf-prog-label{color:var(--teal)}
.wf-type-selector{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.wf-type-btn{padding:7px 16px;border-radius:20px;font-size:12px;font-weight:500;border:1px solid var(--border);background:var(--white);color:var(--text-2);cursor:pointer;transition:all 0.15s;font-family:var(--font-body)}
.wf-type-btn:hover{border-color:#82a7d4;color:var(--text)}
.wf-type-btn.active{background:var(--ink);border-color:var(--ink);color:var(--white);font-weight:600}

/* ── SETTINGS STUB ── */
.under-construction{display:flex;align-items:center;justify-content:center;flex:1;height:100%}

/* ── LOGIN SCREEN ── */
.login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--surface);font-family:var(--font-body)}
.login-card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-lg);padding:40px;width:100%;max-width:380px}
.login-logo{display:flex;align-items:center;gap:12px;margin-bottom:32px;justify-content:center}
.login-logo-mark{width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#245eb0 0%,#1a4a9e 100%);display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 12px rgba(36,94,176,0.35)}
.login-logo-text{font-family:var(--font-display);font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.2px}
.login-logo-sub{font-size:10px;color:var(--muted);font-family:var(--font-mono);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px}
.login-field{margin-bottom:18px}
.login-field label{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;font-family:var(--font-body)}
.login-input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;color:var(--text);background:var(--white);font-family:var(--font-body);outline:none;transition:border-color 0.15s}
.login-input:focus{border-color:#82a7d4;box-shadow:0 0 0 3px rgba(36,94,176,0.15)}
.login-input::placeholder{color:var(--text-3)}
.login-btn{width:100%;padding:12px;border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-body);background:linear-gradient(135deg,#245eb0 0%,#1a4a9e 100%);color:white;transition:all 0.15s;margin-top:8px}
.login-btn:hover:not(:disabled){box-shadow:0 4px 16px rgba(36,94,176,0.35);transform:translateY(-1px)}
.login-btn:disabled{opacity:0.6;cursor:not-allowed;transform:none}
.login-error{font-size:12px;color:var(--red);margin-top:12px;padding:8px 12px;background:var(--red-light);border-radius:var(--radius-sm);font-family:var(--font-body)}
.login-loading{font-family:var(--font-display);font-size:18px;color:var(--text-2)}
.sb-signout{background:none;border:none;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;font-family:var(--font-body);padding:4px 8px;border-radius:6px;margin-left:auto}
.sb-signout:hover{color:#82a7d4;background:rgba(255,255,255,0.06)}

@media (max-width: 768px) {
  html, body { overflow-x: hidden; max-width: 100%; }
  .sidebar { display: none !important; }
  .app {
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    min-height: 100dvh;
    min-height: 100svh;
    height: auto;
    max-height: none;
  }
  .main {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    flex: 1;
    min-height: 0;
  }
  .topbar {
    padding: max(8px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) 8px max(14px, env(safe-area-inset-left, 0px));
    height: auto;
    min-height: 44px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tb-search { width: min(220px, 42vw) !important; flex: 1; min-width: 0; }
  .content { padding: 14px max(14px, env(safe-area-inset-right, 0px)) 88px max(14px, env(safe-area-inset-left, 0px)); }
  .stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .dash-grid { grid-template-columns: 1fr !important; }
  .dash-main-grid { grid-template-columns: 1fr !important; }
  .dash-bottom-grid { grid-template-columns: 1fr !important; }
  .dash-hero { padding: 18px 16px !important; }
  .dash-greeting { font-size: 22px !important; }
  .dash-hero-stats { flex-wrap: wrap; gap: 16px !important; }
  .contacts-layout { grid-template-columns: 1fr !important; height: auto !important; min-height: calc(100dvh - 52px - 68px) !important; }
  .matter-table { font-size: 11px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .mt-thead { display: none; }
  .mt-row { grid-template-columns: 1fr !important; gap: 4px !important; min-width: 0; }
  .ws-tabs { overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
  .ws-tab { font-size: 11px !important; padding: 8px 12px !important; }
  .calendar-grid { font-size: 10px; }
  .calendar-day { min-height: 60px !important; padding: 3px !important; }
  .cal-day-num { font-size: 10px !important; }
  .cal-event-pill { font-size: 9px !important; }
  .week-grid { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
  .contact-modal { width: 100% !important; height: 100% !important; max-height: 100dvh !important; border-radius: 0 !important; max-width: 100% !important; }
  .contact-modal-body { grid-template-columns: 1fr !important; }
  .contact-modal-left { display: none; }
  .contact-modal-right { display: none; }
  .comms-layout { grid-template-columns: 1fr !important; }
  .comms-page { height: calc(100dvh - 52px - 68px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important; min-height: 200px; }
  .comms-page-mid { min-width: 0 !important; }
  .ref-layout { grid-template-columns: 1fr !important; height: auto !important; min-height: min(70dvh, 560px); }
  .intake-grid { grid-template-columns: 1fr !important; }
  .intake-source-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .intake-modal { max-height: 100dvh !important; border-radius: 12px !important; margin: env(safe-area-inset-top, 0px) 8px env(safe-area-inset-bottom, 0px); }
  .wf-progress { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .rdt-summary { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .ws-content { padding: 12px !important; }
  .acc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
  .acc-stat-val { font-size: 18px !important; word-break: break-word; }
  .acc-period-toggle { flex-wrap: wrap; justify-content: flex-start; }
  .acc-period-btn { padding: 6px 10px !important; font-size: 10px !important; }
  .acc-chart-card { padding: 14px !important; overflow-x: auto; }
  .insights-layout { grid-template-columns: 1fr !important; height: auto !important; min-height: 0; }
  .insights-main { max-width: 100%; overflow-x: hidden; }
  .inv-row, .inv-thead {
    grid-template-columns: 64px minmax(80px, 1fr) 72px 72px 52px 48px !important;
    gap: 8px !important;
    padding-left: 12px !important;
    padding-right: 12px !important;
    font-size: 10px !important;
  }
  .icon-btn { min-width: 40px; min-height: 40px; }
  .btn-primary, .btn-gold, .btn-ghost { min-height: 40px; }
  .login-card { padding: 28px 20px !important; margin: 12px; max-width: calc(100% - 24px) !important; }
  .modal-overlay { padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)) !important; }
  .thread-msg { max-width: 90% !important; }
  .contact-fields-grid { grid-template-columns: 1fr !important; }
  .comms-two-col { flex-direction: column !important; }
  .comms-left-col { width: 100% !important; max-height: 40vh; border-right: none; border-bottom: 1px solid var(--border); }
  .mobile-tab-bar {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0 4px;
  }
  .mobile-tab-bar::-webkit-scrollbar { height: 0; display: none; }
}

@media (max-width: 480px) {
  .stat-row { grid-template-columns: 1fr !important; }
  .acc-grid { grid-template-columns: 1fr !important; }
}
`;

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [matterTab, setMatterTab] = useState("Overview");
  const [selectedMatter, setSelectedMatter] = useState(null);
  const [mFilter, setMFilter] = useState("all");
  const [MATTERS, setMATTERS] = useState([]);
  const [mattersLoading, setMattersLoading] = useState(true);
  const [selectedRef, setSelectedRef] = useState(null);
  const [selectedCommId, setSelectedCommId] = useState(1);
  const [commTab, setCommTab] = useState("all");
  const [tasks, setTasks] = useState([]);
  const [comms, setComms] = useState([]);
  const [referrers, setReferrers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [modal, setModal] = useState(null);
  const [intakeStep, setIntakeStep] = useState(0);
  const [intakeSource, setIntakeSource] = useState(null);
  const [intakeText, setIntakeText] = useState("");
  const [intakeExtracting, setIntakeExtracting] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [matterSearches, setMatterSearches] = useState({});
  const [matterEmails, setMatterEmails] = useState([]);
  const [matterEmailsLoading, setMatterEmailsLoading] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [commSearchFilter, setCommSearchFilter] = useState("");
  const [emailSummary, setEmailSummary] = useState(null);
  const [emailSummaryLoading, setEmailSummaryLoading] = useState(false);
  const [aiSummaryExpanded, setAiSummaryExpanded] = useState(false);
  const [expandedEmailId, setExpandedEmailId] = useState(null);
  const [composeModal, setComposeModal] = useState(false);
  const [composeModalMode, setComposeModalMode] = useState("new");
  const [sendSuccessToast, setSendSuccessToast] = useState(false);
  const [commInboxTab, setCommInboxTab] = useState("inbox");
  const [intakeAddress, setIntakeAddress] = useState("");
  const [intakeState, setIntakeState] = useState("NSW");
  const [intakeSuburb, setIntakeSuburb] = useState("");
  const [intakePostcode, setIntakePostcode] = useState("");
  const addressInputRef = useRef(null);
  const autocompleteAttachedRef = useRef(false);
  const [aiMessages, setAiMessages] = useState([
    { id: 0, role: "ai", text: "Good morning. Here's what needs your attention today.", bullets: ["Critical tasks and settlements", "Emails needing a reply", "Overdue items — follow up"] }
  ]);
  const [aiInput, setAiInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const aiEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const composeBodyRef = useRef(null);
  const modalRef = useRef(null);
  const matterModalRef = useRef(null);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contactFilter, setContactFilter] = useState("all");
  const [contactModal, setContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [contactAI, setContactAI] = useState({});
  const [contactAILoading, setContactAILoading] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", type: "Client", email: "", phone: "", address: "", company: "", is_referrer: false, referrer_fee: "", formal_agreement: false, notes: "" });
  const [viewingContact, setViewingContact] = useState(null);
  const [contactEmails, setContactEmails] = useState([]);
  const [contactEmailsLoading, setContactEmailsLoading] = useState(false);
  const [selectedContactEmailId, setSelectedContactEmailId] = useState(null);
  const [emailBodies, setEmailBodies] = useState({});
  const [loadingEmailBodyId, setLoadingEmailBodyId] = useState(null);
  const [contactDetailInboxTab, setContactDetailInboxTab] = useState("all");
  const [contactDetailSearch, setContactDetailSearch] = useState("");
  const [contactEditingInline, setContactEditingInline] = useState(false);
  const [contactEditForm, setContactEditForm] = useState({});
  const [contactAIChat, setContactAIChat] = useState([]);
  const [contactAIChatInput, setContactAIChatInput] = useState("");
  const [contactAITyping, setContactAITyping] = useState(false);
  const [modalSize, setModalSize] = useState({ width: "95vw", height: "90vh" });
  const [contactPanelWidths, setContactPanelWidths] = useState([280, null, 300]);
  const [viewingMatterInModal, setViewingMatterInModal] = useState(null);
  const [matterModalSize, setMatterModalSize] = useState({ width: "90vw", height: "85vh" });
  const [matterModalTab, setMatterModalTab] = useState("Overview");
  const [emailSortAsc, setEmailSortAsc] = useState(false);
  const [matterCommsAIChat, setMatterCommsAIChat] = useState([]);
  const [matterCommsAIChatInput, setMatterCommsAIChatInput] = useState("");
  const [matterCommsAITyping, setMatterCommsAITyping] = useState(false);
  const [mattersCommsModal, setMattersCommsModal] = useState(false);
  const [mattersCommsEmailId, setMattersCommsEmailId] = useState(null);
  const [mattersCommsEmails, setMattersCommsEmails] = useState([]);
  const [mattersCommsLoading, setMattersCommsLoading] = useState(false);
  const [mattersCommsSortAsc, setMattersCommsSortAsc] = useState(false);
  const [mattersCommsTab, setMattersCommsTab] = useState("all");
  const [mattersCommsSearch, setMattersCommsSearch] = useState("");
  const [mattersCommsPanelWidths, setMattersCommsPanelWidths] = useState([280, null, 300]);
  const [mattersCommsModalSize, setMattersCommsModalSize] = useState({ width: "95vw", height: "90vh" });
  const [mattersCommsAIChat, setMattersCommsAIChat] = useState([]);
  const [mattersCommsAIChatInput, setMattersCommsAIChatInput] = useState("");
  const [mattersCommsAITyping, setMattersCommsAITyping] = useState(false);
  const [mattersCommsAISummary, setMattersCommsAISummary] = useState(null);
  const [mattersCommsAISummaryLoading, setMattersCommsAISummaryLoading] = useState(false);
  const [mattersCommsAISummaryExpanded, setMattersCommsAISummaryExpanded] = useState(false);
  const mattersCommsModalRef = useRef(null);
  const [allEmails, setAllEmails] = useState([]);
  const [allEmailsLoading, setAllEmailsLoading] = useState(false);
  const [commsPageSelectedEmailId, setCommsPageSelectedEmailId] = useState(null);
  const [commsSortAsc, setCommsSortAsc] = useState(false);
  const [commsTab, setCommsTab] = useState("all");
  const [commsSearch, setCommsSearch] = useState("");
  const [commsPageAIChat, setCommsPageAIChat] = useState([]);
  const [commsPageAIChatInput, setCommsPageAIChatInput] = useState("");
  const [commsPageAITyping, setCommsPageAITyping] = useState(false);
  const [commsPageAISummary, setCommsPageAISummary] = useState(null);
  const [commsPageAISummaryLoading, setCommsPageAISummaryLoading] = useState(false);
  const [commsPanelWidths, setCommsPanelWidths] = useState([280, null, 300]);
  const [mobileCommsView, setMobileCommsView] = useState("list");

  const [isMobile, setIsMobile] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [marketData, setMarketData] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [insightsAIChat, setInsightsAIChat] = useState([]);
  const [insightsAIChatInput, setInsightsAIChatInput] = useState("");
  const [insightsAITyping, setInsightsAITyping] = useState(false);
  const [insightsAutoSummary, setInsightsAutoSummary] = useState(null);
  const [insightsAutoLoading, setInsightsAutoLoading] = useState(false);
  const [insightsAutoError, setInsightsAutoError] = useState(null);

  const [xeroData, setXeroData] = useState(null);
  const [xeroLoading, setXeroLoading] = useState(true);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroPeriod, setXeroPeriod] = useState("monthly");
  const [xeroChartHoverIdx, setXeroChartHoverIdx] = useState(null);
  const [xeroAIReport, setXeroAIReport] = useState(null);
  const [xeroAIReportLoading, setXeroAIReportLoading] = useState(false);
  const [xeroAccBarHover, setXeroAccBarHover] = useState(null);
  const [txAccountName, setTxAccountName] = useState("");
  const [txModal, setTxModal] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [txData, setTxData] = useState(null);

  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifAI, setNotifAI] = useState(null);
  const notifRef = useRef(null);

  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarView, setCalendarView] = useState("month");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [eventModal, setEventModal] = useState(false);
  const [addEventModal, setAddEventModal] = useState(false);
  const [aiCalendarLoading, setAiCalendarLoading] = useState(false);
  const [dashMorningBrief, setDashMorningBrief] = useState(null);
  const [dashBriefLoading, setDashBriefLoading] = useState(false);
  const [dashAIChat, setDashAIChat] = useState([]);
  const [dashAIChatInput, setDashAIChatInput] = useState("");
  const [dashAITyping, setDashAITyping] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: "", event_type: "meeting", matter_ref: "", client_name: "", date: "", time: "", notes: ""
  });

  const formatXeroMoney = (amount) =>
    "$" +
    Number(amount || 0).toLocaleString("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const fetchXeroData = useCallback(async () => {
    setXeroLoading(true);
    try {
      const res = await fetch(`/api/xero/invoices?period=${encodeURIComponent(xeroPeriod)}`);
      if (res.status === 401) {
        setXeroConnected(false);
        setXeroData(null);
        return;
      }
      const data = await res.json();
      if (data.error) {
        setXeroConnected(false);
        setXeroData(null);
      } else {
        setXeroConnected(true);
        setXeroData(data);
        console.log("Xero full data:", data);
        console.log("xeroData.currentMonth (after load):", data.currentMonth);
      }
    } catch (e) {
      console.log("Xero fetch error:", e);
      setXeroConnected(false);
    } finally {
      setXeroLoading(false);
    }
  }, [xeroPeriod]);

  const fetchTransactions = useCallback(
    async (_accountId, accountName, fromDate, toDate) => {
      setTxAccountName(accountName);
      setTxModal(true);
      setTxLoading(true);
      setTxData(null);

      try {
        const params = new URLSearchParams({
          accountName: accountName || "",
          fromDate:
            fromDate ||
            xeroData?.breakdownPeriod?.fromDate ||
            xeroData?.summary?.fromDate ||
            "2025-07-01",
          toDate:
            toDate ||
            xeroData?.breakdownPeriod?.toDate ||
            xeroData?.summary?.toDate ||
            new Date().toISOString().split("T")[0],
        });

        const res = await fetch(`/api/xero/transactions?${params}`);
        const data = await res.json();
        setTxData(data);
      } catch (e) {
        console.log("Transaction fetch error:", e);
        setTxData({ error: e.message || String(e), transactions: [] });
      }
      setTxLoading(false);
    },
    [xeroData]
  );

  const generateXeroAIReport = useCallback(async () => {
    if (!xeroData?.financialYear?.report) {
      setXeroAIReport(null);
      return;
    }
    setXeroAIReportLoading(true);
    try {
      const xd = xeroData;
      const fyPl = parseXeroProfitAndLoss(xd.financialYear.report);
      const cmPl = parseXeroProfitAndLoss(xd.currentMonth?.report);
      const trendSource =
        xd.monthlyData?.length > 0
          ? xd.monthlyData
          : xd.chartData?.length > 0
            ? xd.chartData
            : xd.quarterlyData || xd.yearlyData || [];
      const monthlySeries = trendSource.map((m) => ({
        month: m.month,
        ...extractPlSeriesFromReport(m.report),
      }));
      const monthlyTrend = monthlySeries
        .slice(-6)
        .map(
          (d) =>
            `${d.month}: Revenue $${d.income.toFixed(0)}, Expenses $${d.expenses.toFixed(0)}, Profit $${d.profit.toFixed(0)}`
        )
        .join("\n");
      const expenseText = fyPl.expenseLineItems.map((r) => `${r.name}: ${r.amount}`).join("\n");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `You are a financial advisor reviewing the accounts 
for Conveyancing Crew, an Australian conveyancing practice.

FINANCIAL YEAR TO DATE (${xd.financialYear.from ?? xd.financialYear.fromDate} - ${xd.financialYear.to ?? xd.financialYear.toDate}):
Total Revenue: $${fyPl.totalIncome.toFixed(0)}
Total Expenses: $${fyPl.totalExpenses.toFixed(0)}
Net Profit: $${fyPl.netProfit.toFixed(0)}

CURRENT MONTH:
Revenue: $${cmPl.totalIncome.toFixed(0)}
Expenses: $${cmPl.totalExpenses.toFixed(0)}
Net Profit: $${cmPl.netProfit.toFixed(0)}

MONTHLY TREND (last 6 months):
${monthlyTrend}

EXPENSE CATEGORIES:
${expenseText || "(none)"}

Please provide a comprehensive financial health report:

1. OVERALL HEALTH: Rate the practice as Excellent/Good/Fair/Needs Attention with a 2 sentence explanation

2. REVENUE ANALYSIS: How is revenue trending? Any concerns or positives?

3. EXPENSE ANALYSIS: Are expenses under control? Any areas of concern?

4. PROFITABILITY: Comment on profit margins and sustainability

5. RECOMMENDATIONS: 3 specific actionable recommendations to improve financial performance

6. CASH FLOW NOTE: Any observations about cash flow timing

Plain English only. No markdown symbols. Conversational and practical.
Maximum 300 words.`,
            },
          ],
          mattersContext: "Financial analysis",
        }),
      });
      const data = await res.json();
      setXeroAIReport(data.content || null);
    } catch (e) {
      console.error(e);
      setXeroAIReport(null);
    } finally {
      setXeroAIReportLoading(false);
    }
  }, [xeroData]);

  useEffect(() => {
    if (!xeroConnected || !xeroData?.financialYear?.report) return;
    generateXeroAIReport();
  }, [xeroConnected, xeroData, generateXeroAIReport]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("xero") === "connected") {
      setXeroConnected(true);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (urlParams.get("xero") === "error") {
      console.log("Xero connection failed");
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetchXeroData();
  }, [fetchXeroData]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { aiEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [aiMessages, isTyping]);

  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target) && !e.target.closest(".icon-btn")) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== "Escape") return;

      if (modal) {
        setModal(null);
        setIntakeStep(0);
        setIntakeSource(null);
        return;
      }

      if (mattersCommsModal) {
        setMattersCommsModal(false);
        setMatterTab("Overview");
        return;
      }

      if (viewingContact) {
        setViewingContact(null);
        setContactAIChat([]);
        return;
      }

      if (contactModal) {
        setContactModal(false);
        return;
      }

      if (notifOpen) {
        setNotifOpen(false);
        return;
      }

      if (searchOpen) {
        setSearchOpen(false);
        setGlobalSearch("");
        return;
      }

      if (composeModal) {
        setComposeModal(false);
        return;
      }

      if (txModal) {
        setTxModal(false);
        return;
      }

      if (eventModal) {
        setEventModal(false);
        setSelectedEvent(null);
        return;
      }

      if (addEventModal) {
        setAddEventModal(false);
        return;
      }

      if (tooltip) {
        setTooltip(null);
        return;
      }

      if (page === "matter_workspace") {
        setPage("matters");
        setSelectedMatter(null);
        setMatterTab("Overview");
        return;
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [
    modal,
    mattersCommsModal,
    viewingContact,
    contactModal,
    notifOpen,
    searchOpen,
    composeModal,
    txModal,
    eventModal,
    addEventModal,
    tooltip,
    page,
  ]);

  useEffect(() => {
    const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (page !== "communications") setMobileCommsView("list");
  }, [page]);

  useEffect(() => {
    if (page === "insights") {
      generateInsightsSummary();
      fetchMarketIntelligence();
    }
  }, [page]);

  useEffect(() => {
    setNotifAI(null);
  }, [calendarEvents, tasks]);

  useEffect(() => {
    const fetchMatters = async () => {
      console.log("Matters fetch started");
      setMattersLoading(true);
      const { data, error } = await supabase
        .from("matters")
        .select("*");

      if (error) {
        console.error("Supabase error fetching matters:", error);
        setMATTERS([]);
      } else {
        console.log("Raw data from Supabase:", data);
        const rows = data || [];
        const mapped = rows.map((row) => ({
          id: row.matter_ref,
          matter_ref: row.matter_ref,
          client: row.client_name,
          client_name: row.client_name,
          email: row.client_email,
          phone: row.client_phone,
          type: row.type,
          address: row.address,
          state: row.state,
          opened: row.opened_date,
          stage: row.stage,
          status: row.status,
          urgency: row.urgency,
          staff: row.staff,
          notes: row.notes,
          settlement: row.settlement_date,
          settlement_date: row.settlement_date,
          pexa: row.pexa ? { workspaceId: row.pexa.workspaceId } : undefined,
        }));
        console.log("Final MATTERS state after setting:", mapped);
        setMATTERS(mapped);
      }

      setMattersLoading(false);
    };

    fetchMatters();
  }, []);

  useEffect(() => {
    const fetchCalendarEvents = async () => {
      setCalendarLoading(true);
      const { data, error } = await supabase.from("calendar_events").select("*").order("date");
      if (error) {
        console.error("Error fetching calendar events:", error);
        setCalendarEvents([]);
        setCalendarLoading(false);
        return;
      }
      let events = data || [];
      const existingRefs = new Set(events.map((e) => (e.matter_ref || "") + (e.event_type || "")));
      const missingSettlements = MATTERS.filter(
        (m) => (m.settlement_date || m.settlement) && !existingRefs.has((m.matter_ref || m.id) + "settlement")
      ).map((m) => ({
        title: "Settlement — " + (m.client_name || m.client),
        event_type: "settlement",
        matter_ref: m.matter_ref || m.id,
        client_name: m.client_name || m.client,
        date: String(m.settlement_date || m.settlement || "").slice(0, 10),
        source: "auto",
        ai_extracted: false
      }));
      if (missingSettlements.length > 0) {
        await supabase.from("calendar_events").insert(missingSettlements);
        const { data: updated } = await supabase.from("calendar_events").select("*").order("date");
        events = updated || [];
      }
      setCalendarEvents(events);
      console.log("Calendar events:", events.length, events.map((e) => e.title + " " + e.date));
      setCalendarLoading(false);
    };
    fetchCalendarEvents();
  }, [MATTERS]);

  useEffect(() => {
    const fetchContacts = async () => {
      setContactsLoading(true);
      const { data, error } = await supabase.from("contacts").select("*").order("name");
      if (error) {
        console.error("Error fetching contacts:", error);
        setContacts([]);
      } else {
        console.log("Total contacts fetched:", data?.length, data);
        setContacts(data || []);
      }
      setContactsLoading(false);
    };
    fetchContacts();
  }, []);

  useEffect(() => {
    const fetchTasks = async () => {
      const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
      if (data) setTasks(data);
    };
    fetchTasks();
  }, []);

  useEffect(() => {
    const fetchInvoices = async () => {
      const { data, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
      if (error) {
        setInvoices([]);
        return;
      }
      setInvoices(data || []);
    };
    fetchInvoices();
  }, []);

  useEffect(() => {
    const fetchReferrers = async () => {
      const { data, error } = await supabase.from("referrers").select("*").order("name");
      if (error) {
        setReferrers([]);
        return;
      }
      setReferrers(data || []);
    };
    fetchReferrers();
  }, []);

  const contactForAI = viewingContact || selectedContact;
  useEffect(() => {
    if (!contactForAI?.id || contactAI[contactForAI.id]) return;
    const loadContactAI = async () => {
      setContactAILoading(true);
      const linkedMatters = MATTERS.filter((m) => m.client && contactForAI.name && (String(m.client).toLowerCase().includes(String(contactForAI.name).toLowerCase()) || String(contactForAI.name).toLowerCase().includes(String(m.client).toLowerCase())));
      const mattersList = linkedMatters.length ? linkedMatters.map((m) => `${m.id} (${m.type}, ${m.stage})`).join("; ") : "None";
      const totalValue = linkedMatters.reduce((s, m) => s + (parseFloat(String(m.price||0).replace(/[^0-9.]/g, "")) || 0), 0);
      const prompt = `You are reviewing contact ${contactForAI.name} (${contactForAI.type || "Contact"}). Their linked matters: ${mattersList}. Generate:\n1. RELATIONSHIP SUMMARY: Who are they, how long have you worked with them\n2. ACTIVE MATTERS: Current status of their matters\n3. NEXT STEPS: What needs to happen for this contact\n4. VALUE: Total matter value across all their matters`;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], mattersContext: "", systemOverride: "You are an assistant for a conveyancing practice. Respond in clear markdown with the requested sections." }),
        });
        const data = await res.json();
        if (res.ok && data.content) setContactAI((prev) => ({ ...prev, [contactForAI.id]: data.content }));
      } catch (_) {}
      setContactAILoading(false);
    };
    loadContactAI();
  }, [contactForAI?.id]);

  const fetchContactEmails = async () => {
    if (!viewingContact?.name) return;
    setContactEmailsLoading(true);
    try {
      const res = await fetch(`/api/email?query=${encodeURIComponent(viewingContact.name)}`);
      const data = res.ok ? await res.json() : [];
      setContactEmails(Array.isArray(data) ? data : []);
    } catch (_) {
      setContactEmails([]);
    } finally {
      setContactEmailsLoading(false);
    }
  };

  useEffect(() => {
    if (viewingContact) {
      fetchContactEmails();
      setSelectedContactEmailId(null);
      setContactDetailInboxTab("all");
      setContactDetailSearch("");
      setContactEditingInline(false);
      setContactAIChat([]);
      setContactAIChatInput("");
    }
  }, [viewingContact?.id]);

  const sendContactAI = async (question) => {
    const q = (question || contactAIChatInput || "").trim();
    if (!q || !viewingContact) return;
    setContactAIChat((prev) => [...prev, { role: "user", text: q }]);
    setContactAIChatInput("");
    setContactAITyping(true);
    const linkedMatters = MATTERS.filter((m) => m.client && (viewingContact.name || "").split(",")[0] && (String(m.client).toLowerCase().includes((viewingContact.name || "").split(",")[0].toLowerCase().trim()) || (viewingContact.name || "").split(",")[0].toLowerCase().trim().includes(String(m.client).toLowerCase())));
    const mattersContextStr = `Contact: ${viewingContact.name} (${viewingContact.type || "Contact"}). Email: ${viewingContact.email || ""}. Phone: ${viewingContact.phone || ""}. Linked matters: ${linkedMatters.length ? linkedMatters.map((m) => `${m.id} - ${m.type} - ${m.stage} - ${m.address || ""}`).join(", ") : "None"}`;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: q }], mattersContext: mattersContextStr }) });
      const data = await response.json();
      setContactAIChat((prev) => [...prev, { role: "ai", text: data.content || "Sorry, I couldn't get a response." }]);
    } catch (_) {
      setContactAIChat((prev) => [...prev, { role: "ai", text: "Sorry, I couldn't get a response." }]);
    }
    setContactAITyping(false);
  };

  const handleModalResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = modalRef.current?.offsetWidth ?? 1200;
    const startH = modalRef.current?.offsetHeight ?? 800;
    const onMove = (ev) => {
      const newW = Math.max(800, startW + ev.clientX - startX);
      const newH = Math.max(500, startH + ev.clientY - startY);
      setModalSize({ width: newW + "px", height: newH + "px" });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handlePanelResize = (e, panelIndex) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelIndex === 0 ? contactPanelWidths[0] : contactPanelWidths[2];
    const onMove = (ev) => {
      const diff = ev.clientX - startX;
      const newWidths = [...contactPanelWidths];
      if (panelIndex === 0) {
        newWidths[0] = Math.max(200, startWidth + diff);
      } else {
        newWidths[2] = Math.max(200, startWidth - diff);
      }
      setContactPanelWidths(newWidths);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleMatterModalResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = matterModalRef.current?.offsetWidth ?? 1200;
    const startH = matterModalRef.current?.offsetHeight ?? 800;
    const onMove = (ev) => {
      const newW = Math.max(800, startW + ev.clientX - startX);
      const newH = Math.max(500, startH + ev.clientY - startY);
      setMatterModalSize({ width: newW + "px", height: newH + "px" });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const fetchMattersCommsEmails = async () => {
    if (!selMatterObj) return;
    setMattersCommsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selMatterObj.address) params.append("address", selMatterObj.address);
      const res = await fetch(`/api/email?${params}`);
      const data = await res.json();
      const emails = Array.isArray(data) ? data : (data?.emails || []);
      setMattersCommsEmails(emails);
      if (emails.length) generateMattersCommsAISummary(emails);
    } catch (e) {
      setMattersCommsEmails([]);
    }
    setMattersCommsLoading(false);
  };

  const generateMattersCommsAISummary = async (emails) => {
    if (!emails.length || !selMatterObj) return;
    setMattersCommsAISummaryLoading(true);
    const emailContext = emails.slice(0, 10).map((e) => `From: ${e.from?.emailAddress?.name || e.from?.name}, Subject: ${e.subject}, Preview: ${(e.bodyPreview || "").slice(0, 150)}`).join("\n");
    const dueTasks = tasks.filter((t) => t.matter === (selMatterObj.matter_ref || selMatterObj.id) && !t.done);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Summarise communications for this matter" }],
          mattersContext: `Matter ${selMatterObj.matter_ref || selMatterObj.id} - ${selMatterObj.client_name || selMatterObj.client || ""}\nProperty: ${selMatterObj.address || ""}\nStage: ${selMatterObj.stage || ""}\nDue Tasks: ${dueTasks.map((t) => `${t.task} due ${t.due}`).join(", ") || "None"}\nEmails:\n${emailContext}\n\nReply in plain English with:\n1. OVERVIEW: What are these emails about in 2 sentences\n2. KEY POINTS: 3 most important things from emails as simple numbered list\n3. NEXT STEPS: 2-3 specific actions needed\n4. URGENCY: Low, Medium or High with one sentence why\n\nNo markdown symbols. Plain English only.`,
        }),
      });
      const data = await res.json();
      setMattersCommsAISummary(data.content || null);
    } catch (_) {}
    setMattersCommsAISummaryLoading(false);
  };

  const sendMattersCommsAI = async (question) => {
    const q = (question || mattersCommsAIChatInput || "").trim();
    if (!q || !selMatterObj) return;
    setMattersCommsAIChat((prev) => [...prev, { role: "user", text: q }]);
    setMattersCommsAIChatInput("");
    setMattersCommsAITyping(true);
    const dueTasks = tasks.filter((t) => t.matter === (selMatterObj.matter_ref || selMatterObj.id) && !t.done);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: q }],
          mattersContext: `Matter: ${selMatterObj.matter_ref || selMatterObj.id}\nClient: ${selMatterObj.client_name || selMatterObj.client || ""}\nProperty: ${selMatterObj.address || ""}\nStage: ${selMatterObj.stage || ""}\nValue: ${selMatterObj.price || ""}\nSettlement: ${selMatterObj.settlement || ""}\nDue Tasks: ${dueTasks.map((t, i) => `${i + 1}. ${t.task} due ${t.due} (${t.urgency})`).join("\n") || "None"}\nRecent emails: ${mattersCommsEmails.slice(0, 5).map((e) => `${e.from?.name || e.from?.address || ""}: ${e.subject || ""}`).join(", ")}\n\nPlain English only. No markdown. If tasks due list them numbered.`,
        }),
      });
      const data = await res.json();
      setMattersCommsAIChat((prev) => [...prev, { role: "ai", text: data.content || "Sorry I could not get a response." }]);
    } catch (_) {
      setMattersCommsAIChat((prev) => [...prev, { role: "ai", text: "Sorry I could not get a response." }]);
    }
    setMattersCommsAITyping(false);
  };

  const handleMattersCommsModalResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = mattersCommsModalRef.current?.offsetWidth ?? 1200;
    const startH = mattersCommsModalRef.current?.offsetHeight ?? 800;
    const onMove = (ev) => {
      const newW = Math.max(800, startW + ev.clientX - startX);
      const newH = Math.max(500, startH + ev.clientY - startY);
      setMattersCommsModalSize({ width: newW + "px", height: newH + "px" });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleMattersCommsPanelResize = (e, panelIndex) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelIndex === 0 ? mattersCommsPanelWidths[0] : mattersCommsPanelWidths[2];
    const onMove = (ev) => {
      const diff = ev.clientX - startX;
      const newWidths = [...mattersCommsPanelWidths];
      if (panelIndex === 0) newWidths[0] = Math.max(200, startWidth + diff);
      else newWidths[2] = Math.max(200, startWidth - diff);
      setMattersCommsPanelWidths(newWidths);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const fetchAllEmails = async () => {
    setAllEmailsLoading(true);
    try {
      const res = await fetch("/api/email?allEmails=true&top=50");
      const data = await res.json();
      const emails = data.emails || data || [];
      setAllEmails(emails);
      generateCommsPageSummary(emails);
    } catch (e) {
      setAllEmails([]);
    }
    setAllEmailsLoading(false);
  };

  const generateCommsPageSummary = async (emails) => {
    if (!emails || emails.length === 0) return;
    setCommsPageAISummaryLoading(true);
    const MAILBOX = process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL || "gitu@conveyancingcrew.com.au";
    const fromAddr = (e) => (e.from?.emailAddress?.address || e.from?.address || "").toLowerCase();
    const inboxEmails = emails.filter((e) => fromAddr(e) !== MAILBOX.toLowerCase());
    const sentEmails = emails.filter((e) => fromAddr(e) === MAILBOX.toLowerCase());
    const today = new Date().toISOString().split("T")[0];
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `You are reviewing both inbox and sent messages for Gitu Kaur at Conveyancing Crew, an Australian conveyancing practice. Consider incoming and outgoing emails together.\nToday: ${today}\n\nINBOX (${inboxEmails.length} emails):\n${inboxEmails.slice(0, 15).map((e) => `From: ${e.from?.emailAddress?.name || e.from?.name} | Subject: ${e.subject} | Date: ${new Date(e.receivedDateTime).toLocaleDateString("en-AU")} | Preview: ${(e.bodyPreview || "").slice(0, 150)}`).join("\n")}\n\nSENT (${sentEmails.length} emails):\n${sentEmails.slice(0, 15).map((e) => `To: ${e.toRecipients?.[0]?.emailAddress?.name || e.toRecipients?.[0]?.address} | Subject: ${e.subject} | Date: ${new Date(e.receivedDateTime).toLocaleDateString("en-AU")} | Preview: ${(e.bodyPreview || "").slice(0, 150)}`).join("\n")}\n\nKNOWN MATTERS:\n${MATTERS.filter((m) => m.status === "active").slice(0, 10).map((m) => `${m.matter_ref}: ${m.client_name} | ${m.stage}`).join("\n")}\n\nPlease provide a comprehensive email intelligence summary covering BOTH inbox and sent:\n\n1. OVERVIEW: How many emails (inbox + sent), general activity level (2 sentences)\n\n2. URGENT: List any emails needing immediate attention (replies overdue, urgent requests, deadlines mentioned) — from either inbox or sent\n\n3. BY MATTER: Group emails by which matter they relate to. For each matter mention what the email activity shows (incoming and outgoing).\n\n4. FOLLOW UPS NEEDED: List specific actions Gitu needs to take based on what she has received or sent\n\n5. PATTERNS: Any notable patterns (e.g. a client emailing multiple times, unanswered emails, threads where she has replied)\n\nPlain English only. No markdown symbols. Keep each section concise.`
          }],
          mattersContext: "Communications page email summary"
        })
      });
      const data = await res.json();
      setCommsPageAISummary(data.content || null);
    } catch (_) {
      setCommsPageAISummary(null);
    }
    setCommsPageAISummaryLoading(false);
  };

  const handleCommsPanelResize = (e, panelIndex) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelIndex === 0 ? commsPanelWidths[0] : commsPanelWidths[2];
    const onMove = (ev) => {
      const diff = ev.clientX - startX;
      const newWidths = [...commsPanelWidths];
      if (panelIndex === 0) newWidths[0] = Math.max(200, startWidth + diff);
      else newWidths[2] = Math.max(200, startWidth - diff);
      setCommsPanelWidths(newWidths);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const sendCommsPageAI = async (question) => {
    const q = (question || commsPageAIChatInput || "").trim();
    if (!q) return;
    setCommsPageAIChat((prev) => [...prev, { role: "user", text: q }]);
    setCommsPageAIChatInput("");
    setCommsPageAITyping(true);
    const selectedEmail = allEmails.find((e) => e.id === commsPageSelectedEmailId);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...commsPageAIChat.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
            { role: "user", content: q }
          ],
          mattersContext: `Communications context:\nTotal emails: ${allEmails.length}\n${selectedEmail ? `Currently viewing email:\nFrom: ${selectedEmail.from?.emailAddress?.name || selectedEmail.from?.name}\nSubject: ${selectedEmail.subject}\nPreview: ${(selectedEmail.bodyPreview || "").slice(0, 300)}` : "No email selected"}\n\nActive matters: ${MATTERS.filter((m) => m.status === "active").map((m) => `${m.matter_ref}: ${m.client_name} | ${m.stage}`).join(", ")}\n\nPlain English only. No markdown. End with one clear next action.`
        })
      });
      const data = await res.json();
      setCommsPageAIChat((prev) => [...prev, { role: "ai", text: data.content || "Sorry, could not get a response." }]);
    } catch (_) {
      setCommsPageAIChat((prev) => [...prev, { role: "ai", text: "Sorry, could not get a response." }]);
    }
    setCommsPageAITyping(false);
  };

  const fetchMarketIntelligence = async () => {
    setMarketLoading(true);
    try {
      const suburbs = [...new Set(
        MATTERS.filter((m) => m.address)
          .map((m) => {
            const parts = (m.address || "").split(" ");
            const stateIdx = parts.findIndex((p) => p === "NSW" || p === "VIC");
            return stateIdx > 0 ? parts[stateIdx - 1] : parts[parts.length - 3];
          })
          .filter(Boolean)
      )].slice(0, 5);
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suburbs: suburbs.length ? suburbs : ["Sydney", "Melbourne"] })
      });
      const data = await res.json();
      setMarketData(data?.error ? null : data);
    } catch (_) {
      setMarketData(null);
    }
    setMarketLoading(false);
  };

  const generateInsightsSummary = async () => {
    setInsightsAutoLoading(true);
    setInsightsAutoError(null);
    try {
      const activeM = MATTERS.filter((m) => m.status === "active");
      const settledM = MATTERS.filter((m) => m.stage === "Settled");
      const totalM = MATTERS.length;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `Provide a comprehensive business intelligence summary for Conveyancing Crew practice.\n\nFIRM DATA:\nTotal matters: ${totalM}\nActive matters: ${activeM.length}\nSettled matters: ${settledM.length}\nSettlement rate: ${totalM ? Math.round((settledM.length / totalM) * 100) : 0}%\n\nMatter types: ${["Purchase", "Sale", "Lease", "Contract Review", "General Enquiry"].map((t) => `${t}: ${MATTERS.filter((m) => m.type === t).length}`).join(", ")}\n\nStates: NSW: ${MATTERS.filter((m) => m.state === "NSW").length}, VIC: ${MATTERS.filter((m) => m.state === "VIC").length}\n\nClient sources: ${[...new Set(MATTERS.map((m) => m.source).filter(Boolean))].map((s) => `${s}: ${MATTERS.filter((m) => m.source === s).length}`).join(", ") || "Not tracked"}\n\nActive pipeline stages:\n${["Intake", "Contract Review", "Contract Sent", "Searches Ordered", "PEXA Ready"].map((s) => `${s}: ${activeM.filter((m) => m.stage === s).length}`).join(", ")}\n\nProvide:\n1. PERFORMANCE SUMMARY: How is the practice doing overall\n2. STRENGTHS: What is working well\n3. OPPORTUNITIES: Areas for growth\n4. PIPELINE HEALTH: Assessment of current active matters\n5. RECOMMENDATIONS: 3 specific actionable recommendations\n\nPlain English. No markdown. Conversational tone. Under 250 words total.`
          }],
          mattersContext: "Insights page auto-summary"
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setInsightsAutoSummary(null);
        setInsightsAutoError(data.error || "Report could not be generated.");
        return;
      }
      const text = data.content != null ? String(data.content).trim() : "";
      setInsightsAutoSummary(text || null);
      if (!text) setInsightsAutoError("No report content returned.");
    } catch (e) {
      setInsightsAutoSummary(null);
      setInsightsAutoError("Report could not be generated. Check your connection or try again.");
    } finally {
      setInsightsAutoLoading(false);
    }
  };

  const sendInsightsAI = async (question) => {
    const q = (question || insightsAIChatInput || "").trim();
    if (!q) return;
    setInsightsAIChat((prev) => [...prev, { role: "user", text: q }]);
    setInsightsAIChatInput("");
    setInsightsAITyping(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...insightsAIChat.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
            { role: "user", content: q }
          ],
          mattersContext: `Practice Intelligence Context:\nTotal matters: ${MATTERS.length}\nActive: ${MATTERS.filter((m) => m.status === "active").length}\nSettled: ${MATTERS.filter((m) => m.stage === "Settled").length}\nTypes: ${["Purchase", "Sale", "Lease"].map((t) => `${t}:${MATTERS.filter((m) => m.type === t).length}`).join(", ")}\nStates: NSW:${MATTERS.filter((m) => m.state === "NSW").length} VIC:${MATTERS.filter((m) => m.state === "VIC").length}\n${marketData?.marketOverview ? `Market: Sydney ${(marketData.marketOverview.sydney || "").slice(0, 100)}` : ""}\n\nPlain English only. No markdown. End with one recommendation.`
        })
      });
      const data = await res.json();
      setInsightsAIChat((prev) => [...prev, { role: "ai", text: data.content || "Sorry could not get a response." }]);
    } catch (_) {
      setInsightsAIChat((prev) => [...prev, { role: "ai", text: "Sorry could not get a response." }]);
    }
    setInsightsAITyping(false);
  };

  const scanEmailsForEvents = async () => {
    setAiCalendarLoading(true);
    try {
      console.log("Fetching PEXA emails...");
      const pexaRes = await fetch("/api/email?pexa=true");
      const pexaData = await pexaRes.json();
      const pexaEmails = pexaData.emails || pexaData || [];
      console.log("PEXA emails found:", pexaEmails.length);

      const pexaWithBodies = await Promise.all(
        pexaEmails.slice(0, 30).map(async (e) => {
          try {
            const res = await fetch(`/api/email?emailId=${e.id}`);
            const data = await res.json();
            const rawBody = data.body != null ? data.body : "";
            const fullBody = String(rawBody)
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 800);
            return { ...e, fullBody };
          } catch {
            return e;
          }
        })
      );

      const matterContext = MATTERS.map((m) => {
        const skipWords = ["and", "the", "of", "&", "mr", "mrs", "ms", "dr"];
        const allNameParts = ((m.client_name || m.client || "") + " " + (m.other_party || ""))
          .split(/[\s,&|\/\\]+/)
          .map((n) => n.trim().toLowerCase())
          .filter((n) => n.length >= 3 && !skipWords.includes(n));
        return {
          matter_ref: m.matter_ref || m.id,
          client_name: m.client_name || m.client,
          address: m.address,
          settlement_date: m.settlement_date || m.settlement,
          name_keywords: [...new Set(allNameParts)],
          other_party: m.other_party || ""
        };
      });

      pexaWithBodies.forEach((email) => {
        const emailText = (email.subject + " " + (email.bodyPreview || email.fullBody || "")).toLowerCase();
        const matchedMatter = matterContext.find((m) =>
          m.name_keywords.some((keyword) => emailText.includes(keyword))
        );
        if (matchedMatter) {
          email.preMatchedMatter = matchedMatter.matter_ref;
          email.preMatchedClient = matchedMatter.client_name;
          console.log("Pre-matched:", email.subject, "→", matchedMatter.matter_ref, matchedMatter.client_name);
        }
      });

      console.log("Sending to Claude for extraction...");

      const today = new Date().toISOString().split("T")[0];
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `You are extracting settlement dates from PEXA emails for Conveyancing Crew, an Australian conveyancing practice.

PEXA always sends emails confirming settlement workspace details and settlement dates. Match each PEXA email to a matter by looking for client last names, property addresses, or matter references in the email content.

TODAY: ${today}

OUR MATTERS (match PEXA emails to these):
${matterContext
  .map(
    (m) =>
      `Matter: ${m.matter_ref}
   Client: ${m.client_name}
   Address: ${m.address || ""}
   Other party: ${m.other_party || ""}
   Current settlement date in DB: ${m.settlement_date || "NOT SET - needs extraction"}`
  )
  .join("\n---\n")}

MATCHING RULES - match PEXA emails to matters by:
1. Look for ANY name keyword from the matter in the email subject OR body content
   Example: matter has 'Verma, Nitin' → look for 'verma' or 'nitin'
   Example: matter has 'Singh & Kaur' → look for 'singh' or 'kaur'
2. PEXA workspace IDs (WS-XXXX) if visible note them
3. If multiple matters share a common name, use other context clues like suburb, property type, or date to disambiguate
4. If you cannot confidently match, set confidence to 'low'

NAME KEYWORDS PER MATTER:
${matterContext
  .map((m) => `${m.matter_ref} (${m.client_name}): look for → [${m.name_keywords.join(", ")}]`)
  .join("\n")}

PEXA EMAIL MATCHING EXAMPLES:
- Subject 'Verma purchase PEXA workspace ready' → match to matter with 'verma' in name keywords
- Subject 'Singh Kaur settlement 17/03/2026' → match to matter with 'singh' or 'kaur'
- Body mentions 'settlement date 17 March 2026' + client name 'Nitin' → extract date 2026-03-17

PEXA EMAILS TO ANALYSE:
${pexaWithBodies
  .map(
    (e) =>
      `Email ID: ${e.id}
   Pre-matched to matter: ${e.preMatchedMatter || "unmatched"}
   From: ${e.from?.name || ""} <${e.from?.address || ""}>
   Subject: ${e.subject || ""}
   Received: ${e.receivedDateTime ? new Date(e.receivedDateTime).toLocaleDateString("en-AU") : ""}
   Content: ${e.fullBody || e.bodyPreview || ""}`
  )
  .join("\n===\n")}

TASK:
1. Match each PEXA email to one of our matters above (use name keywords; pre-match hint if present)
2. Extract the settlement DATE and TIME from each email
3. Create a calendar event for each confirmed settlement

DATE EXTRACTION:
- PEXA uses format: DD/MM/YYYY or D Month YYYY
- Look for words: "settlement date", "settle on", "scheduled for", "confirmed for", "workspace"
- Also look for time: "10:00 AM", "2:00 PM" etc

Return ONLY a valid JSON array:
[
  {
    "title": "Settlement — [Client Last Name]",
    "event_type": "settlement",
    "date": "YYYY-MM-DD",
    "time": "HH:MM AM/PM or null",
    "matter_ref": "matter ref or null",
    "client_name": "full client name",
    "notes": "PEXA workspace details + source email subject",
    "confidence": "high/medium/low",
    "matched_by": "how you matched this email to the matter"
  }
]

Only include events where you are reasonably confident about the date and the matter match.
If no matches found return: []`
          }],
          mattersContext: "PEXA settlement extraction"
        })
      });

      const data = await response.json();
      const rawText = data.content || "[]";
      console.log("AI PEXA extraction response:", rawText);

      let aiEvents = [];
      try {
        const clean = rawText.replace(/```json|```/g, "").trim();
        const jsonMatch = clean.match(/\[[\s\S]*\]/);
        if (jsonMatch) aiEvents = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.log("Parse error:", e);
      }
      console.log("Events extracted by AI:", aiEvents);

      const goodEvents = (Array.isArray(aiEvents) ? aiEvents : []).filter(
        (e) =>
          e.confidence !== "low" &&
          e.date &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(e.date).slice(0, 10)) &&
          e.title
      );

      const existing = (calendarEvents || []).map((e) => ((e.matter_ref || "") + (e.date || "")).toLowerCase());
      const newEvents = goodEvents.filter((e) => !existing.includes(((e.matter_ref || "") + (e.date || "").slice(0, 10)).toLowerCase()));

      console.log("New events to add:", newEvents);

      if (newEvents.length > 0) {
        const toInsert = newEvents.map((e) => ({
          title: e.title,
          event_type: "settlement",
          matter_ref: e.matter_ref || null,
          client_name: e.client_name || null,
          date: String(e.date).slice(0, 10),
          time: e.time || null,
          notes: e.notes || null,
          source: "pexa_email",
          ai_extracted: true
        }));

        await supabase.from("calendar_events").insert(toInsert);

        for (const event of newEvents) {
          if (!event.matter_ref) continue;

          const matterUpdates = {};
          if (event.event_type === "settlement" && event.date) {
            matterUpdates.settlement_date = String(event.date).slice(0, 10);
            const matter = MATTERS.find((m) => (m.matter_ref || m.id) === event.matter_ref);
            if (matter && ["Intake", "Contract Review", "Contract Sent", "Searches Ordered"].includes(matter.stage)) {
              matterUpdates.stage = "PEXA Ready";
            }
          }
          if (Object.keys(matterUpdates).length > 0) {
            const { error: matterError } = await supabase
              .from("matters")
              .update(matterUpdates)
              .eq("matter_ref", event.matter_ref);
            if (matterError) {
              console.log("Matter update error:", matterError);
            } else {
              console.log("Updated matter:", event.matter_ref, matterUpdates);
            }
          }

          if (event.client_name) {
            const firstNamePart = event.client_name.split(",")[0].trim();
            const { data: contact } = await supabase
              .from("contacts")
              .select("id, notes")
              .ilike("name", "%" + firstNamePart + "%")
              .maybeSingle();
            if (contact) {
              const newNote =
                "Settlement: " +
                event.date +
                (event.time ? " at " + event.time : "") +
                (contact.notes ? "\n" + contact.notes : "");
              await supabase.from("contacts").update({ notes: newNote }).eq("id", contact.id);
              console.log("Updated contact:", event.client_name);
            }
          }

          if (event.event_type === "settlement" && event.date) {
            const settlementDate = new Date(event.date + "T00:00:00");
            const today = new Date();
            const daysUntil = Math.ceil((settlementDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntil > 0 && daysUntil <= 30) {
              const { data: existingTask } = await supabase
                .from("tasks")
                .select("id")
                .eq("matter_ref", event.matter_ref)
                .ilike("task", "%settlement%")
                .maybeSingle();
              if (!existingTask) {
                await supabase.from("tasks").insert({
                  matter_ref: event.matter_ref,
                  client_name: event.client_name,
                  task:
                    "Settlement due — " +
                    event.date +
                    (event.time ? " at " + event.time : "") +
                    " — confirm PEXA workspace ready",
                  due_date: event.date,
                  urgency: daysUntil <= 3 ? "critical" : daysUntil <= 7 ? "high" : "medium",
                  done: false
                });
                console.log("Created settlement task for:", event.matter_ref);
              }
            }
          }
        }
      }

      let newTasks = [];
      let newCalEvents = [];

      const activeMatters = MATTERS.filter((m) => m.status === "active" && (m.address || "").length > 5).slice(0, 10);
      const allMatterEmailsForTasks = [];
      for (const m of activeMatters) {
        try {
          const [inboxRes, sentRes] = await Promise.all([
            fetch(`/api/email?address=${encodeURIComponent(m.address)}&sent=false`),
            fetch(`/api/email?address=${encodeURIComponent(m.address)}&sent=true`)
          ]);
          const inboxData = await inboxRes.json();
          const sentData = await sentRes.json();
          const inboxList = inboxData.emails || inboxData || [];
          const sentList = sentData.emails || sentData || [];
          const emails = [
            ...inboxList.map((e) => ({ ...e, matterRef: m.matter_ref, clientName: m.client_name, address: m.address, direction: "inbox" })),
            ...sentList.map((e) => ({ ...e, matterRef: m.matter_ref, clientName: m.client_name, address: m.address, direction: "sent" }))
          ];
          allMatterEmailsForTasks.push(...emails);
        } catch (err) {
          console.log("Error fetching emails for", m.matter_ref, err);
        }
      }
      const seenIds = new Set();
      const uniqueMatterEmails = allMatterEmailsForTasks
        .filter((e) => {
          if (seenIds.has(e.id)) return false;
          seenIds.add(e.id);
          return true;
        })
        .sort((a, b) => new Date(b.receivedDateTime || 0) - new Date(a.receivedDateTime || 0))
        .slice(0, 50);

      const fromName = (e) => e.from?.name || e.from?.emailAddress?.name || "";
      const taskExtractionRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                `You are scanning emails for Conveyancing Crew to find actionable tasks and deadlines.\n\nTODAY: ${new Date().toISOString().split("T")[0]}\n\nACTIVE MATTERS:\n${MATTERS.filter((m) => m.status === "active")
                  .map((m) => `${m.matter_ref}: ${m.client_name} | ${m.stage} | ${m.address}`)
                  .join("\n")}\n\nEMAILS TO SCAN (both sent and received):\n${uniqueMatterEmails
                  .map(
                    (e) =>
                      `[${(e.direction || "").toUpperCase()}] Matter:${e.matterRef} | From:${fromName(e)} | Subject:${e.subject || ""} | Date:${e.receivedDateTime ? new Date(e.receivedDateTime).toLocaleDateString("en-AU") : ""} | Content:${(e.bodyPreview || "").slice(0, 200)}`
                  )
                  .join("\n---\n")}\n\nTASK EXTRACTION RULES:\nFind ALL actionable items including:\n1. Documents requested but not yet received\n2. Information requested from client\n3. Deadlines mentioned\n4. Follow-ups needed\n5. Things promised but not done\n6. Urgent requests\n7. Search orders needed\n8. PEXA actions needed\n9. Payment actions\n10. Certificate requests\n\nFor each task found return:\n{"task":"clear description","matter_ref":"...","client_name":"...","due_date":"YYYY-MM-DD or null","urgency":"critical/high/medium/low","source":"brief description","type":"document|information|deadline|followup|payment|search|pexa|certificate|other"}\n\nOnly include tasks that are ACTIONABLE and NOT YET DONE. Return ONLY a valid JSON array. Empty array if nothing found.`
            }
          ],
          mattersContext: "Task extraction from emails"
        })
      });
      const taskData = await taskExtractionRes.json();
      const rawTaskText = taskData.content || "[]";
      let extractedTasks = [];
      try {
        const clean = rawTaskText.replace(/```json|```/g, "").trim();
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) extractedTasks = JSON.parse(match[0]);
      } catch (parseErr) {
        console.log("Task parse error:", parseErr);
      }

      if (extractedTasks.length > 0) {
        const { data: existingTasks } = await supabase.from("tasks").select("task,matter_ref");
        const existingTaskKeys = new Set((existingTasks || []).map((t) => (String(t.task) + String(t.matter_ref)).toLowerCase().slice(0, 50)));
        newTasks = extractedTasks
          .filter((t) => t.task && t.matter_ref)
          .filter((t) => !existingTaskKeys.has((String(t.task) + String(t.matter_ref)).toLowerCase().slice(0, 50)))
          .map((t) => ({
            task: t.task,
            matter_ref: t.matter_ref,
            client_name: t.client_name || null,
            due_date: t.due_date || null,
            urgency: t.urgency || "medium",
            done: false,
            notes: "AI extracted from email: " + (t.source || "")
          }));
        if (newTasks.length > 0) {
          const { error: taskError } = await supabase.from("tasks").insert(newTasks);
          if (taskError) console.error("Tasks insert error:", taskError);
        }
      }

      const taskCalendarEvents = (extractedTasks || [])
        .filter((t) => t.due_date && t.matter_ref && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date))
        .map((t) => ({
          title: (t.task || "").slice(0, 60),
          event_type: t.type === "deadline" ? "deadline" : t.type === "payment" ? "finance" : t.type === "pexa" ? "settlement" : "task",
          matter_ref: t.matter_ref,
          client_name: t.client_name,
          date: t.due_date,
          notes: "AI extracted: " + (t.source || ""),
          source: "ai_email_scan",
          ai_extracted: true
        }));
      const existingCalKeys = new Set((calendarEvents || []).map((e) => (String(e.title) + String(e.date)).toLowerCase().slice(0, 50)));
      newCalEvents = taskCalendarEvents.filter((e) => !existingCalKeys.has((String(e.title) + String(e.date)).toLowerCase().slice(0, 50)));
      if (newCalEvents.length > 0) {
        await supabase.from("calendar_events").insert(newCalEvents);
      }

      const { data: updatedCal } = await supabase.from("calendar_events").select("*").order("date");
      setCalendarEvents(updatedCal || []);
      const { data: updatedTasks } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
      setTasks(updatedTasks || []);
      const { data: updatedMatters } = await supabase.from("matters").select("*").order("opened_date", { ascending: false });
      setMATTERS(updatedMatters || []);

      const settlementCount = newEvents?.length || 0;
      const taskCount = newTasks?.length || 0;
      const calEventCount = newCalEvents?.length || 0;
      alert(
        "✦ Email Intelligence Scan Complete!\n\n" +
          "Settlements found: " +
          settlementCount +
          "\nTasks extracted: " +
          taskCount +
          "\nCalendar events added: " +
          (calEventCount + settlementCount) +
          "\n\n" +
          (taskCount > 0 ? "New tasks:\n" + newTasks.slice(0, 5).map((t) => "• " + t.task + " (" + (t.urgency || "medium") + ")").join("\n") : "No new tasks found in emails.")
      );
    } catch (err) {
      console.log("Scan error:", err);
      alert("Scan failed — check console for details");
    }
    setAiCalendarLoading(false);
  };

  const handleGlobalSearch = (query) => {
    setGlobalSearch(query);
    if (!query || query.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const q = query.toLowerCase();
    const matterResults = MATTERS.filter(
      (m) =>
        (m.client_name || m.client || "").toLowerCase().includes(q) ||
        (m.matter_ref || m.id || "").toLowerCase().includes(q) ||
        (m.address || "").toLowerCase().includes(q) ||
        (m.stage || "").toLowerCase().includes(q) ||
        (m.type || "").toLowerCase().includes(q)
    )
      .slice(0, 5)
      .map((m) => ({
        type: "matter",
        id: m.matter_ref || m.id,
        title: m.client_name || m.client,
        subtitle: m.address,
        meta: m.stage,
        tag: m.type,
        action: () => {
          setSelectedMatter(m.matter_ref || m.id);
          setPage("matter_workspace");
          setMatterTab("Overview");
          setSearchOpen(false);
          setGlobalSearch("");
        }
      }));
    const contactResults = (contacts || [])
      .filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.email || "").toLowerCase().includes(q) ||
          (c.phone || "").includes(q) ||
          (c.company || "").toLowerCase().includes(q)
      )
      .slice(0, 5)
      .map((c) => ({
        type: "contact",
        id: c.id,
        title: c.name,
        subtitle: c.email || c.phone,
        meta: c.type,
        tag: c.type,
        action: () => {
          setPage("contacts");
          setViewingContact(c);
          setSearchOpen(false);
          setGlobalSearch("");
        }
      }));
    const calendarResults = (calendarEvents || [])
      .filter(
        (e) =>
          (e.title || "").toLowerCase().includes(q) ||
          (e.client_name || "").toLowerCase().includes(q) ||
          (e.matter_ref || "").toLowerCase().includes(q)
      )
      .slice(0, 3)
      .map((e) => ({
        type: "calendar",
        id: e.id,
        title: e.title,
        subtitle: new Date(e.date + "T00:00:00").toLocaleDateString("en-AU", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric"
        }),
        meta: e.event_type,
        tag: e.event_type,
        action: () => {
          setPage("calendar");
          setCalendarDate(new Date(e.date + "T00:00:00"));
          setSearchOpen(false);
          setGlobalSearch("");
        }
      }));
    const results = [...matterResults, ...contactResults, ...calendarResults];
    setSearchResults(results);
    setSearchOpen(results.length > 0);
  };

  const buildNotifications = () => {
    const notifs = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    (calendarEvents || [])
      .filter((e) => e.event_type === "settlement")
      .forEach((e) => {
        const d = new Date(e.date + "T00:00:00");
        const days = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
        if (days >= 0 && days <= 7) {
          notifs.push({
            id: "settle-" + e.id,
            type: "settlement",
            urgency: days <= 1 ? "critical" : days <= 3 ? "high" : "medium",
            title:
              days === 0
                ? "Settlement TODAY"
                : days === 1
                  ? "Settlement TOMORROW"
                  : "Settlement in " + days + " days",
            body: e.title + (e.time ? " at " + e.time : ""),
            matter_ref: e.matter_ref,
            date: e.date,
            icon: "🏠"
          });
        }
      });
    (tasks || [])
      .filter((t) => !t.done && t.due_date)
      .forEach((t) => {
        const d = new Date(t.due_date + "T00:00:00");
        const days = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
        if (days < 0) {
          notifs.push({
            id: "task-" + t.id,
            type: "task",
            urgency: "high",
            title: "Overdue task",
            body: t.task + " — " + (t.client_name || t.client),
            matter_ref: t.matter_ref || t.matter,
            date: t.due_date,
            icon: "⚠️"
          });
        } else if (days === 0) {
          notifs.push({
            id: "task-today-" + t.id,
            type: "task",
            urgency: t.urgency === "critical" ? "critical" : "high",
            title: "Task due today",
            body: t.task + " — " + (t.client_name || t.client),
            matter_ref: t.matter_ref || t.matter,
            date: t.due_date,
            icon: "📋"
          });
        }
      });
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    notifs.sort((a, b) => (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3));
    return notifs;
  };

  const openNotifications = async () => {
    setNotifOpen(true);
    const notifs = buildNotifications();
    setNotifications(notifs);
    if (notifs.length > 0 && !notifAI) {
      setNotifLoading(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                role: "user",
                content: `Based on these notifications for a conveyancing practice,
provide 3-5 specific suggested next actions in plain English.
Be practical and specific.

Notifications:
${notifs.map((n) => `${n.urgency.toUpperCase()}: ${n.title} — ${n.body}`).join("\n")}

Format as a simple numbered list of actions.
No markdown. Plain English only.`
              }
            ],
            mattersContext: "Notification action suggestions"
          })
        });
        const data = await res.json();
        setNotifAI(data.content || null);
      } catch (err) {
        console.log("Notif AI error:", err);
      }
      setNotifLoading(false);
    }
  };

  const generateMorningBrief = async () => {
    setDashBriefLoading(true);
    setDashMorningBrief(null);
    const today = new Date().toISOString().split("T")[0];
    const todayObj = new Date();
    todayObj.setHours(0, 0, 0, 0);
    const activeMatters = MATTERS.filter((m) => m.status === "active");
    const settlementsThisWeek = (calendarEvents || []).filter((e) => {
      if (e.event_type !== "settlement") return false;
      const d = new Date(e.date + "T00:00:00");
      const weekEnd = new Date(todayObj);
      weekEnd.setDate(todayObj.getDate() + 7);
      return d >= todayObj && d <= weekEnd;
    }).length;
    const overdueTasks = (tasks || []).filter((t) => {
      if (t.done) return false;
      if (t.due_date) return new Date(t.due_date + "T00:00:00") < todayObj;
      return false;
    }).length;
    const tasksDueToday = (tasks || []).filter((t) => {
      if (t.done) return false;
      if (t.due_date && t.due_date === today) return true;
      if (t.due === "Today") return true;
      return false;
    }).length;
    const criticalMatters = activeMatters.filter((m) => m.urgency === "critical" || m.urgency === "high").length;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `You are an AI assistant for Gitu Kaur at Conveyancing Crew.
Today is ${today}.

Active matters: ${activeMatters.length}
Settlements this week: ${settlementsThisWeek}
Overdue tasks: ${overdueTasks}
Tasks due today: ${tasksDueToday}
Critical matters: ${criticalMatters}

Top matters by urgency:
${activeMatters
                .slice(0, 5)
                .map((m) => `${m.matter_ref || m.id}: ${m.client_name || m.client} - ${m.stage} - Settlement: ${m.settlement_date || m.settlement || "TBD"}`)
                .join("\n")}

Provide a morning briefing in plain English:
1. One sentence summary of the day
2. Top 3 priorities for today (numbered list)
3. One thing to watch out for this week

Keep it under 150 words. Conversational tone. No markdown symbols.`
            }
          ],
          mattersContext: "Morning briefing"
        })
      });
      const data = await res.json();
      setDashMorningBrief(data.content || null);
    } catch (err) {
      console.log("Morning brief error:", err);
    }
    setDashBriefLoading(false);
  };

  const sendDashAI = async (question) => {
    const q = question || dashAIChatInput.trim();
    if (!q) return;
    setDashAIChat((prev) => [...prev, { role: "user", text: q }]);
    setDashAIChatInput("");
    setDashAITyping(true);
    const today = new Date().toISOString().split("T")[0];
    const activeMatters = MATTERS.filter((m) => m.status === "active");
    const dueTasks = (tasks || []).filter((t) => !t.done);
    const upcomingSettlements = (calendarEvents || [])
      .filter((e) => e.event_type === "settlement")
      .filter((e) => new Date(e.date + "T00:00:00") >= new Date())
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...dashAIChat.map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.text
            })),
            { role: "user", content: q }
          ],
          mattersContext: `Today: ${today}
Practice: Conveyancing Crew — Gitu Kaur, NSW & VIC
Active matters: ${activeMatters.length}
Outstanding tasks: ${dueTasks.length}
Upcoming settlements: ${upcomingSettlements.map((e) => `${e.client_name} on ${e.date}`).join(", ") || "none"}

Top active matters:
${activeMatters
            .slice(0, 8)
            .map(
              (m) =>
                `${m.matter_ref || m.id}: ${m.client_name || m.client} | ${m.type} | ${m.stage} | Settlement: ${m.settlement_date || m.settlement || "TBD"} | ${m.address || ""}`
            )
            .join("\n")}

Due tasks:
${dueTasks
            .slice(0, 10)
            .map((t) => `${t.task} — ${t.client_name || t.client} (${t.urgency}) due ${t.due_date || t.due || "TBD"}`)
            .join("\n")}

RESPONSE RULES:
- Plain English only, no markdown symbols
- Be conversational and practical
- End every response with "Next step:" followed by one clear recommended action
- If asked about a specific matter, give specific details
- Keep responses under 150 words unless more detail is asked`
        })
      });
      const data = await res.json();
      setDashAIChat((prev) => [
        ...prev,
        { role: "ai", text: data.content || "Sorry, I could not get a response." }
      ]);
    } catch (err) {
      console.log("Dash AI error:", err);
      setDashAIChat((prev) => [...prev, { role: "ai", text: "Sorry, I could not get a response." }]);
    }
    setDashAITyping(false);
  };

  useEffect(() => {
    if (page === "dashboard" && !dashMorningBrief && !dashBriefLoading) generateMorningBrief();
  }, [page]);

  const sendAI = async (q) => {
    const msg = q || aiInput.trim();
    if (!msg) return;
    setAiMessages((p) => [...p, { id: p.length, role: "user", text: msg }]);
    setAiInput("");
    setIsTyping(true);

    const apiMessages = aiMessages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text + (m.bullets ? "\n" + m.bullets.join("\n") : ""),
    }));
    apiMessages.push({ role: "user", content: msg });

    const mattersContext = MATTERS.length
      ? MATTERS.map(
          (m) =>
            `Matter ${m.id}: Client ${m.client}, Type ${m.type}, Stage ${m.stage}, Urgency ${m.urgency || "—"}, Opened ${m.opened || "—"}${m.settlement ? ", Settlement " + m.settlement : ""}`
        ).join("\n")
      : "No matters in the system.";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, mattersContext }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get AI response");
      }
      setAiMessages((p) => [
        ...p,
        { id: p.length, role: "ai", text: data.content || "" },
      ]);
    } catch (err) {
      setAiMessages((p) => [
        ...p,
        {
          id: p.length,
          role: "ai",
          text: "Sorry, I couldn’t complete that. " + (err.message || "Please try again."),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const runExtract = () => {
    setIntakeExtracting(true);
    setTimeout(() => { setIntakeExtracting(false); setIntakeStep(2); }, 1600);
  };

  const handleDocumentUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDocumentFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !selMatterObj) return;
    const matterRef = selMatterObj.matter_ref || selMatterObj.id;
    if (!matterRef) return;
    const sanitizedName = file.name.trim().replace(/\s+/g, '_');
    const filePath = selMatterObj.matter_ref + '/' + sanitizedName;
    setUploadingDocument(true);
    try {
      const { error } = await supabase.storage
        .from("matter-documents")
        .upload(filePath, file);
      if (error) {
        console.error("Error uploading document:", error);
      } else {
        const { data, error: listError } = await supabase.storage
          .from("matter-documents")
          .list(matterRef);
        if (listError) {
          console.error("Error refreshing documents after upload:", listError);
        } else {
          setDocuments(data || []);
        }
      }
    } finally {
      setUploadingDocument(false);
      if (e.target) {
        e.target.value = "";
      }
    }
  };

  const handleViewDocument = async (file) => {
    if (!selMatterObj) return;
    const matterRef = selMatterObj.matter_ref || selMatterObj.id;
    if (!matterRef) return;
    console.log("Full file object:", JSON.stringify(file));
    const cleanName = file.name.trim();
    const path = `${matterRef}/${cleanName}`;
    console.log("Attempting to view document at path:", path);

    try {
      const res = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: "matter-documents",
          path,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Error from /api/storage:", data);
        alert(`Error creating signed URL: ${data.error || "Unknown error"}`);
        return;
      }
      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank");
      }
    } catch (err) {
      console.error("Unexpected error calling /api/storage:", err);
      alert(`Error creating signed URL: ${err.message || JSON.stringify(err)}`);
    }
  };

  const handleDeleteDocument = async (docName) => {
    if (!selMatterObj) return;
    const matterRef = selMatterObj.matter_ref || selMatterObj.id;
    if (!matterRef) return;
    const cleanName = docName.trim();
    const path = `${matterRef}/${cleanName}`;
    const { error } = await supabase.storage
      .from("matter-documents")
      .remove([path]);
    if (error) {
      console.error("Error deleting document:", error);
      return;
    }
    const { data, error: listError } = await supabase.storage
      .from("matter-documents")
      .list(matterRef);
    if (listError) {
      console.error("Error refreshing documents after delete:", listError);
    } else {
      setDocuments(data || []);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setLoginLoading(false);
    if (error) {
      setLoginError(error.message);
      return;
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const activeM = MATTERS.filter(m => m.status === "active");
  const closedM = MATTERS.filter(m => m.status === "closed");
  const selMatterObj = MATTERS.find(m => m.id === selectedMatter);
  const selComm = comms.find(c => c.id === selectedCommId);
  const selRef = referrers.find(r => r.id === selectedRef);

  useEffect(() => {
    if (page === "communications") fetchAllEmails();
  }, [page]);

  useEffect(() => {
    const id = viewingContact ? selectedContactEmailId : (mattersCommsModal && selMatterObj ? mattersCommsEmailId : (matterTab === "Communications" && selMatterObj ? selectedEmailId : (page === "communications" ? commsPageSelectedEmailId : null)));
    if (!id || emailBodies[id] !== undefined) return;
    let cancelled = false;
    setLoadingEmailBodyId(id);
    fetch(`/api/email?emailId=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setEmailBodies((prev) => ({ ...prev, [id]: { content: data?.body ?? null, contentType: data?.bodyContentType || "text" } }));
      })
      .catch(() => {
        if (!cancelled) setEmailBodies((prev) => ({ ...prev, [id]: { content: null, contentType: "text" } }));
      })
      .finally(() => {
        if (!cancelled) setLoadingEmailBodyId(null);
      });
    return () => { cancelled = true; };
  }, [viewingContact, selectedContactEmailId, matterTab, selMatterObj, selectedEmailId, mattersCommsModal, mattersCommsEmailId, page, commsPageSelectedEmailId, emailBodies]);

  const fetchMatterEmails = async () => {
    if (!selMatterObj) return;
    setMatterEmailsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selMatterObj.address) params.set("address", selMatterObj.address);
      const url = `/api/email?${params.toString()}`;
      console.log("[Communications] fetch URL:", url);
      const res = await fetch(url);
      console.log("[Communications] response status:", res.status);
      const data = res.ok ? await res.json() : [];
      console.log("[Communications] parsed response data:", data, "isArray:", Array.isArray(data), "length:", Array.isArray(data) ? data.length : "n/a");
      const emails = Array.isArray(data) ? data : [];
      setMatterEmails(emails);
      console.log("[Communications] set matterEmails to", emails.length, "items");
    } catch (err) {
      console.error("[Communications] fetch error:", err);
      setMatterEmails([]);
    } finally {
      setMatterEmailsLoading(false);
    }
  };

  useEffect(() => {
    if (matterTab === "Communications" && selMatterObj) {
      fetchMatterEmails();
      if (selMatterObj.email) setComposeTo(selMatterObj.email);
    }
  }, [matterTab, selMatterObj?.id]);

  useEffect(() => {
    if (matterTab === "Communications" && selMatterObj?.id) {
      setSelectedEmailId(null);
      setExpandedEmailId(null);
      setComposeModal(false);
      setAiSummaryExpanded(false);
      setCommInboxTab("inbox");
      setMatterCommsAIChat([]);
      setMatterCommsAIChatInput("");
    }
  }, [matterTab, selMatterObj?.id]);

  useEffect(() => {
    setMattersCommsEmails([]);
    setMattersCommsEmailId(null);
    setMattersCommsAIChat([]);
    setMattersCommsAIChatInput("");
    setMattersCommsAISummary(null);
    setMattersCommsAISummaryExpanded(false);
  }, [selectedMatter]);

  useEffect(() => {
    if (matterTab === "Communications") {
      console.log("[Communications] emails state (after set):", matterEmails?.length ?? 0, "items", matterEmails);
    }
  }, [matterTab, matterEmails]);

  const sendMatterCommsAI = async (question) => {
    const q = (question || matterCommsAIChatInput || "").trim();
    if (!q || !selMatterObj) return;
    setMatterCommsAIChat((prev) => [...prev, { role: "user", text: q }]);
    setMatterCommsAIChatInput("");
    setMatterCommsAITyping(true);
    const dueTasks = tasks.filter((t) => t.matter === (selMatterObj.matter_ref || selMatterObj.id) && !t.done);
    const emailContext = (matterEmails || []).slice(0, 5).map((e) => `From: ${e.from?.name || e.from?.address || ""}, Subject: ${e.subject || ""}, Preview: ${(e.bodyPreview || "").slice(0, 100)}`).join("\n") || "No emails found";
    const mattersContextStr = `Matter: ${selMatterObj.matter_ref || selMatterObj.id}
Client: ${selMatterObj.client_name || selMatterObj.client || ""}
Type: ${selMatterObj.type || ""}
Stage: ${selMatterObj.stage || ""}
Property: ${selMatterObj.address || ""}
Value: ${selMatterObj.price || ""}
Settlement: ${selMatterObj.settlement || ""}
State: ${selMatterObj.state || ""}
Special Conditions: ${selMatterObj.specialConditions || selMatterObj.notes || ""}
Notes: ${selMatterObj.notes || ""}

Due Tasks:
${dueTasks.length > 0 ? dueTasks.map((t, i) => `${i + 1}. ${t.task} — due ${t.due} (${t.urgency})`).join("\n") : "No outstanding tasks"}

Recent Email Activity:
${emailContext}

RESPONSE RULES - ALWAYS follow these:
- Respond in plain conversational English only
- No markdown symbols like ** # ## --- 
- If listing tasks use simple numbered list: 1. task name
- Be concise and practical
- Focus on what needs to happen next
- Maximum 150 words unless asked for more detail`;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: q }], mattersContext: mattersContextStr }) });
      const data = await response.json();
      setMatterCommsAIChat((prev) => [...prev, { role: "ai", text: data.content || "Sorry I could not get a response." }]);
    } catch (_) {
      setMatterCommsAIChat((prev) => [...prev, { role: "ai", text: "Sorry I could not get a response." }]);
    }
    setMatterCommsAITyping(false);
  };

  const handleReplyToEmail = (email) => {
    if (!email) return;
    const toAddress = email.isOutgoing
      ? (email.toRecipients?.[0]?.emailAddress?.address || email.toRecipients?.[0]?.address || "")
      : (email.from?.emailAddress?.address || email.from?.address || "");
    setComposeTo(toAddress);
    setComposeSubject((s) => (s && s.startsWith("Re:") ? s : `Re: ${email.subject || ""}`.trim()));
    setComposeBody("");
    setComposeModalMode("reply");
    setComposeModal(true);
  };

  const handleForwardEmail = (email) => {
    if (!email) return;
    const sender = email.from?.emailAddress?.name || email.from?.name || email.from?.emailAddress?.address || email.from?.address || "";
    const date = email.receivedDateTime ? new Date(email.receivedDateTime).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "";
    const rawSubject = email.subject || "(No subject)";
    const subject = rawSubject.startsWith("Fwd:") ? rawSubject : `Fwd: ${rawSubject}`;
    const bodyPreview = email.bodyPreview || "";
    const forwardedBlock = `\n\n-------- Forwarded Message --------\nFrom: ${sender}\nDate: ${date}\nSubject: ${rawSubject}\n\n${bodyPreview}`;
    setComposeTo("");
    setComposeSubject(subject);
    setComposeBody(forwardedBlock);
    setComposeModalMode("forward");
    setComposeModal(true);
  };

  useEffect(() => {
    if (composeModal && composeBodyRef.current) {
      const t = composeBodyRef.current;
      const id = setTimeout(() => { t.focus(); t.setSelectionRange(0, 0); }, 50);
      return () => clearTimeout(id);
    }
  }, [composeModal]);

  function formatCommsTime(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const today = now.toDateString() === d.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (today) return "Today " + d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    if (yesterday.toDateString() === d.toDateString()) return "Yesterday " + d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    const daysDiff = Math.floor((now - d) / (24 * 60 * 60 * 1000));
    if (daysDiff < 7) return d.toLocaleDateString("en-AU", { weekday: "short" }) + " " + d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  }

  const formatEmailDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    if (diffDays < 7) return date.toLocaleDateString("en-AU", { weekday: "short" }) + " " + date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  const groupEmailsByDate = (emails) => {
    const groups = {};
    emails.forEach((e) => {
      const date = new Date(e.receivedDateTime);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      let label;
      if (date.toDateString() === today.toDateString()) {
        label = "Today";
      } else if (date.toDateString() === yesterday.toDateString()) {
        label = "Yesterday";
      } else if (date.getFullYear() === today.getFullYear()) {
        label = date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
      } else {
        label = date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
      }
      if (!groups[label]) groups[label] = [];
      groups[label].push(e);
    });
    return groups;
  };

  function parseEmailSummary(raw) {
    if (!raw || typeof raw !== "string") return { overview: "", keyPoints: [], nextSteps: [], urgency: "", urgencyLevel: "" };
    const s = raw.replace(/\r\n/g, "\n").trim();
    const sections = { overview: "", keyPoints: [], nextSteps: [], urgency: "", urgencyLevel: "" };
    const re = /(?:^|\n)\s*(?:\d+\.\s*)?(OVERVIEW|KEY POINTS|NEXT STEPS|URGENCY)\s*:?\s*[\n]*/gi;
    const parts = s.split(re).map((p) => p.trim());
    for (let i = 1; i < parts.length; i += 2) {
      const key = (parts[i] || "").toUpperCase();
      const val = parts[i + 1] || "";
      if (key === "OVERVIEW") sections.overview = val;
      if (key === "KEY POINTS") sections.keyPoints = val.split(/\n/).map((l) => l.replace(/^[\s\-•*]+\s*/, "").trim()).filter(Boolean);
      if (key === "NEXT STEPS") sections.nextSteps = val.split(/\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
      if (key === "URGENCY") {
        sections.urgency = val;
        const lower = val.toLowerCase();
        if (lower.startsWith("high")) sections.urgencyLevel = "high";
        else if (lower.startsWith("medium")) sections.urgencyLevel = "medium";
        else if (lower.startsWith("low")) sections.urgencyLevel = "low";
      }
    }
    return sections;
  }

  function renderSummaryMarkdown(text) {
    if (!text || typeof text !== "string") return null;
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let listItems = [];
    const parseInlineMarkdown = (str) => {
      const parts = [];
      let rest = str;
      while (rest.length) {
        const bold = rest.match(/^\*\*([^*]+)\*\*/);
        if (bold) {
          parts.push(<span key={parts.length} style={{fontWeight:700,color:"var(--text)"}}>{bold[1]}</span>);
          rest = rest.slice(bold[0].length);
          continue;
        }
        const i = rest.indexOf("**");
        if (i === -1) {
          parts.push(rest);
          break;
        }
        parts.push(rest.slice(0, i));
        const end = rest.indexOf("**", i + 2);
        if (end === -1) {
          parts.push(rest.slice(i));
          break;
        }
        parts.push(<span key={parts.length} style={{fontWeight:700,color:"var(--text)"}}>{rest.slice(i + 2, end)}</span>);
        rest = rest.slice(end + 2);
      }
      return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <span>{parts}</span>;
    };
    const flushList = () => {
      if (listItems.length === 0) return;
      out.push(
        <ul key={out.length} style={{listStyle:"none",padding:0,margin:"4px 0 8px 0"}}>
          {listItems.map((item, i) => (
            <li key={i} style={{paddingLeft:20,position:"relative",marginBottom:4,fontSize:13,lineHeight:1.7,color:"var(--text-2)"}}>
              <span style={{position:"absolute",left:0,top:0,fontSize:12,fontWeight:700,color:item.numbered?"var(--gold)":"var(--teal)"}}>{item.numbered ? (i + 1) + "." : "•"}</span>
              {parseInlineMarkdown(item.text)}
            </li>
          ))}
        </ul>
      );
      listItems = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (/^###?\s/.test(trimmed)) {
        flushList();
        const heading = trimmed.replace(/^###?\s*/, "");
        out.push(<div key={out.length} style={{fontWeight:700,fontSize:11,fontFamily:"var(--font-mono)",textTransform:"uppercase",color:"var(--text-3)",marginTop:out.length ? 12 : 0,marginBottom:4}}>{parseInlineMarkdown(heading)}</div>);
        continue;
      }
      if (/^[\-\•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        listItems.push({ text: numMatch ? numMatch[2] : trimmed.replace(/^[\-\•]\s*/, ""), numbered: !!numMatch });
        continue;
      }
      if (trimmed === "") {
        flushList();
        continue;
      }
      if (listItems.length > 0) flushList();
      out.push(<div key={out.length} style={{fontSize:13,lineHeight:1.7,color:"var(--text-2)",marginBottom:6}}>{parseInlineMarkdown(trimmed)}</div>);
    }
    flushList();
    return <>{out}</>;
  }

  useEffect(() => {
    if (matterTab !== "Communications") return;
    if (!matterEmails?.length) {
      setEmailSummary(null);
      setEmailSummaryLoading(false);
      return;
    }
    if (matterEmailsLoading) return;
    const clientName = selMatterObj?.client || "the client";
    const address = selMatterObj?.address || "the property";
    const emailsBlurb = matterEmails.map((e) => `From: ${e.from?.name || e.from?.address || ""}, Subject: ${e.subject || ""}, Preview: ${e.bodyPreview || ""}`).join("\n");
    const systemContext = `You are reviewing all emails related to a conveyancing matter for ${clientName} regarding ${address}.\nHere are all the relevant emails found:\n${emailsBlurb}`;
    const userPrompt = `Please provide:\n1. OVERVIEW: A 2-3 sentence plain English summary of all communications\n2. KEY POINTS: 3-5 bullet points of the most important things discussed\n3. NEXT STEPS: 2-3 specific recommended actions based on the emails\n4. URGENCY: Rate as Low/Medium/High with one sentence explanation`;
    setEmailSummary(null);
    setEmailSummaryLoading(true);
    (async () => {
      try {
        const mattersContext = selMatterObj ? `Current matter: ${selMatterObj.id}, Client: ${selMatterObj.client}, Type: ${selMatterObj.type}, Stage: ${selMatterObj.stage}.` : "";
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              { role: "user", content: `${systemContext}\n\n${userPrompt}` },
            ],
            mattersContext,
          }),
        });
        const data = await res.json();
        if (res.ok && data.content) setEmailSummary(data.content);
        else setEmailSummary("Summary unavailable.");
      } catch (_) {
        setEmailSummary("Summary unavailable.");
      } finally {
        setEmailSummaryLoading(false);
      }
    })();
  }, [matterTab, matterEmails, matterEmailsLoading, selMatterObj?.id, selMatterObj?.client, selMatterObj?.address]);

  const sendMatterEmail = async () => {
    if (!composeTo.trim() || !composeSubject.trim()) return;
    setSendingEmail(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeTo.trim(),
          subject: composeSubject.trim(),
          body: composeBody.trim(),
          matterId: selMatterObj?.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setComposeTo("");
        setComposeSubject("");
        setComposeBody("");
        setComposeModal(false);
        setSendSuccessToast(true);
        setTimeout(() => setSendSuccessToast(false), 3000);
        fetchMatterEmails();
      } else {
        alert(data.error || "Failed to send email");
      }
    } catch (e) {
      alert(e.message || "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  const requestEmailDraft = async () => {
    const selectedEmail = (matterEmails || []).find((e) => e.id === selectedEmailId);
    if (!selectedEmail) {
      alert("Please select an email to reply to first.");
      return;
    }
    const fromName = selectedEmail.from?.emailAddress?.name || selectedEmail.from?.name || "";
    const fromAddr = selectedEmail.from?.emailAddress?.address || selectedEmail.from?.address || "";
    const signOff = process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL || "Conveyancing Crew";
    setAiDraftLoading(true);
    try {
      const systemContext = `You are a conveyancer drafting a professional email reply. Matter: ${selMatterObj?.matter_ref ?? selMatterObj?.id ?? ""}, Client: ${selMatterObj?.client_name ?? selMatterObj?.client ?? ""}, Property: ${selMatterObj?.address ?? ""}`;
      const userMessage = `Please draft a professional reply to this email:
From: ${fromName || fromAddr || "—"}
Subject: ${selectedEmail.subject ?? ""}
Message: ${selectedEmail.bodyPreview ?? ""}

The reply should be concise, professional and in plain English.
Sign off as ${signOff}.
Return only the email body text, no subject line.`;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
          mattersContext: selMatterObj ? `Current matter: ${selMatterObj.id}, Client: ${selMatterObj.client}, Type: ${selMatterObj.type}, Stage: ${selMatterObj.stage}.` : "",
          systemOverride: systemContext,
        }),
      });
      const data = await res.json();
      if (res.ok && data.content) setComposeBody(data.content.trim());
      else alert("Could not generate draft");
    } catch (_) {
      alert("Could not generate draft");
    } finally {
      setAiDraftLoading(false);
    }
  };

  useEffect(() => {
    const fetchDocuments = async () => {
      if (!selMatterObj) {
        setDocuments([]);
        return;
      }
      const matterRef = selMatterObj.matter_ref || selMatterObj.id;
      if (!matterRef) {
        setDocuments([]);
        return;
      }
      setDocumentsLoading(true);
      const { data, error } = await supabase.storage
        .from("matter-documents")
        .list(matterRef);
      if (error) {
        console.error("Error fetching documents from storage:", error);
        setDocuments([]);
      } else {
        console.log("Documents from storage for", matterRef, data);
        setDocuments(data || []);
      }
      setDocumentsLoading(false);
    };
    fetchDocuments();
  }, [selMatterObj]);

  useEffect(() => {
    if (modal !== "intake" || intakeStep !== 2) {
      autocompleteAttachedRef.current = false;
      return;
    }
    const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
    if (!key) return;
    const initAutocomplete = () => {
      if (!window.google?.maps?.places || !addressInputRef.current || autocompleteAttachedRef.current) return;
      autocompleteAttachedRef.current = true;
      const autocomplete = new window.google.maps.places.Autocomplete(addressInputRef.current, { types: ["address"], componentRestrictions: { country: "au" } });
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place || !place.address_components) return;
        const addr = place.formatted_address || place.name || "";
        setIntakeAddress(addr);
        let state = "";
        let suburb = "";
        let postcode = "";
        for (const c of place.address_components) {
          if (c.types.includes("administrative_area_level_1")) state = c.short_name || c.long_name || "";
          if (c.types.includes("locality")) suburb = c.long_name || "";
          if (c.types.includes("postal_code")) postcode = c.long_name || "";
        }
        if (state) {
          const s = state.toUpperCase();
          if (s === "NSW" || s === "VIC") setIntakeState(s);
          else if (state.toLowerCase().includes("victoria")) setIntakeState("VIC");
          else if (state.toLowerCase().includes("new south") || state.toLowerCase().includes("nsw")) setIntakeState("NSW");
          else setIntakeState(state);
        }
        if (suburb) setIntakeSuburb(suburb);
        if (postcode) setIntakePostcode(postcode);
      });
    };
    if (window.google?.maps?.places) {
      initAutocomplete();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setTimeout(initAutocomplete, 100);
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [modal, intakeStep]);

  const pageTitle = {
    dashboard:"Dashboard", matters:"Matters", referrals:"Referrals",
    contacts:"Contacts", calendar:"Calendar", communications:"Communications", accounting:"Accounting",
    insights:"Insights", settings:"Settings", matter_workspace:"Matter"
  };

  const NAV = [
    { id:"dashboard", icon:"⊞", label:"Dashboard" },
    { id:"matters", icon:"⚖️", label:"Matters", badge:activeM.length },
    { id:"referrals", icon:"🤝", label:"Referrals" },
    { id:"contacts", icon:"👥", label:"Contacts" },
    { id:"calendar", icon:"📅", label:"Calendar" },
    { id:"communications", icon:"✉️", label:"Communications", badge:(comms||[]).filter(c=>c.unread).length },
    { id:"accounting", icon:"💰", label:"Accounting" },
    { id:"insights", icon:"✦", label:"Insights" },
  ];

  const AVATAR_COLORS = ["#0f766e","#1d4ed8","#7c3aed","#ca8a04","#dc2626","#ea580c"];

  const EVENT_COLORS = {
    settlement: { bg: "#dcfce7", text: "#16a34a", border: "#86efac", dot: "#16a34a" },
    finance: { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd", dot: "#1d4ed8" },
    meeting: { bg: "#f5f3ff", text: "#7c3aed", border: "#c4b5fd", dot: "#7c3aed" },
    task: { bg: "#fefce8", text: "#ca8a04", border: "#fde047", dot: "#ca8a04" },
    search: { bg: "#fdf4ff", text: "#9333ea", border: "#e9d5ff", dot: "#9333ea" },
    contract: { bg: "#fff7ed", text: "#ea580c", border: "#fdba74", dot: "#ea580c" },
    deadline: { bg: "#fef2f2", text: "#dc2626", border: "#fca5a5", dot: "#dc2626" },
    auto: { bg: "#f0faf9", text: "#0f766e", border: "#99f6e4", dot: "#0f766e" },
  };

  if (authLoading) {
    return (
      <>
        <style>{CSS}</style>
        <div className="login-screen">
          <div className="login-loading">Checking auth...</div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <style>{CSS}</style>
        <div className="login-screen">
          <div className="login-card">
            <div className="login-logo">
              <div className="login-logo-mark">⚖️</div>
              <div>
                <div className="login-logo-text">Conveyancing Crew</div>
                <div className="login-logo-sub">Practice OS · NSW & VIC</div>
              </div>
            </div>
            <form onSubmit={handleLogin}>
              <div className="login-field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  className="login-input"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="login-field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  className="login-input"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <button type="submit" className="login-btn" disabled={loginLoading}>
                {loginLoading ? "Signing in…" : "Sign In"}
              </button>
              {loginError && <div className="login-error">{loginError}</div>}
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* ── SIDEBAR ── */}
        <div className="sidebar">
          <div className="sb-brand">
            <div className="sb-logo">
              <div className="sb-logo-mark">
                <img src="https://mhdyxhxybcbowhcszxct.supabase.co/storage/v1/object/public/public-assets/logo-jpg%20new.jpg" alt="Conveyancing Crew" style={{height:"32px",width:"auto",objectFit:"contain"}}/>
              </div>
              <div>
                <div className="sb-logo-sub">Practice OS · NSW & VIC</div>
              </div>
            </div>
          </div>
          <div className="sb-nav">
            <div className="sb-section">Workspace</div>
            {NAV.map(n => (
              <button key={n.id}
                className={`sb-item ${page===n.id || (page==="matter_workspace" && n.id==="matters") ? "active" : ""}`}
                onClick={() => { setPage(n.id); if (n.id !== "matters") setSelectedMatter(null); }}>
                <span className="sb-icon">{n.icon}</span>
                {n.label}
                {n.badge ? <span className="sb-badge">{n.badge}</span> : null}
              </button>
            ))}
            <div className="sb-section">System</div>
            <button className="sb-item" onClick={() => setPage("settings")}><span className="sb-icon">⚙️</span>Settings</button>
          </div>
          <div className="sb-footer">
            <div className="sb-avatar">JC</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="sb-user-name">Jessica Chen</div>
              <div className="sb-user-role">Conveyancer · NSW</div>
            </div>
            <button type="button" className="sb-signout" onClick={handleSignOut}>Sign out</button>
            <div className="sb-online"/>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main">

          {/* ── TOPBAR ── */}
          <div className="topbar" style={isMobile ? { flexShrink: 0 } : undefined}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {page==="matter_workspace" && (
                <button className="btn-ghost" style={{padding:"5px 10px",fontSize:11}}
                  onClick={() => { setPage("matters"); setSelectedMatter(null); }}>← Matters</button>
              )}
              <div>
                <div className="tb-page" style={isMobile ? { fontSize: 16 } : undefined}>
                  {page==="matter_workspace" && selMatterObj ? selMatterObj.client : pageTitle[page] || "Conveyancing Crew"}
                </div>
                {!isMobile && (
                <div className="tb-page-sub">
                  {page==="matter_workspace" && selMatterObj ? selMatterObj.id + " · " + selMatterObj.type : "Conveyancing Crew · NSW & VIC"}
                </div>
                )}
              </div>
            </div>
            <div className="tb-right" style={{display:"flex",alignItems:"center",gap:10}}>
              {isMobile ? (
                <>
                  <div style={{position:"relative"}} ref={searchRef}>
                    <button type="button" className="icon-btn" style={{width:36,height:36}} onClick={() => setSearchOpen(true)} title="Search">🔍</button>
                  </div>
                  <div className="icon-btn" style={{ position: "relative", cursor: "pointer" }} onClick={openNotifications}>
                    🔔
                    {(() => { const notifCount = buildNotifications().length; return notifCount > 0 ? <div className="dot" style={{ background: "var(--red)" }}>{notifCount > 9 ? "9+" : notifCount}</div> : null; })()}
                  </div>
                  <button type="button" className="btn-gold" style={{padding:"6px 12px",fontSize:12}} onClick={()=>setModal("intake")}>＋</button>
                </>
              ) : (
              <>
              <div style={{position:"relative"}} ref={searchRef}>
                <div className="tb-search">
                  <span style={{color:"var(--text-3)",fontSize:12}}>🔍</span>
                  <input
                    placeholder="Search matters, clients, calendar..."
                    value={globalSearch}
                    onChange={(e) => handleGlobalSearch(e.target.value)}
                    onFocus={() => globalSearch.length >= 2 && setSearchOpen(true)}
                  />
                  {globalSearch && (
                    <span
                      style={{cursor:"pointer",color:"var(--text-3)",fontSize:11}}
                      onClick={() => {
                        setGlobalSearch("");
                        setSearchResults([]);
                        setSearchOpen(false);
                      }}
                    >
                      ✕
                    </span>
                  )}
                </div>
                {searchOpen && searchResults.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "var(--white)",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--border)",
                      boxShadow: "var(--shadow-xl)",
                      zIndex: 500,
                      maxHeight: 400,
                      overflowY: "auto",
                      marginTop: 4
                    }}
                  >
                    {["matter", "contact", "calendar"].map((type) => {
                      const group = searchResults.filter((r) => r.type === type);
                      if (!group.length) return null;
                      const icons = { matter: "⚖️", contact: "👤", calendar: "📅" };
                      const labels = { matter: "Matters", contact: "Contacts", calendar: "Calendar" };
                      return (
                        <div key={type}>
                          <div
                            style={{
                              padding: "6px 14px",
                              fontSize: 9,
                              fontFamily: "var(--font-mono)",
                              color: "var(--text-3)",
                              textTransform: "uppercase",
                              letterSpacing: "1.5px",
                              background: "var(--surface)",
                              borderBottom: "1px solid var(--border-2)"
                            }}
                          >
                            {icons[type]} {labels[type]}
                          </div>
                          {group.map((r) => (
                            <div
                              key={r.id}
                              style={{
                                padding: "10px 14px",
                                cursor: "pointer",
                                display: "flex",
                                gap: 10,
                                alignItems: "center",
                                borderBottom: "1px solid var(--border-2)",
                                transition: "background 0.1s"
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--white)")}
                              onClick={r.action}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: "var(--text)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                  }}
                                >
                                  {r.title}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-3)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                  }}
                                >
                                  {r.subtitle}
                                </div>
                              </div>
                              <span
                                className={`tag ${type === "matter" ? "tag-teal" : type === "contact" ? "tag-blue" : "tag-amber"}`}
                                style={{ fontSize: 9, flexShrink: 0 }}
                              >
                                {r.meta}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    <div
                      style={{
                        padding: "8px 14px",
                        fontSize: 10,
                        color: "var(--text-3)",
                        fontFamily: "var(--font-mono)",
                        textAlign: "center",
                        background: "var(--surface)"
                      }}
                    >
                      Press ESC to close
                    </div>
                  </div>
                )}
              </div>
              <div
                className="icon-btn"
                onClick={openNotifications}
                style={{ position: "relative", cursor: "pointer" }}
              >
                🔔
                {(() => {
                  const notifCount = buildNotifications().length;
                  return notifCount > 0 ? (
                    <div className="dot" style={{ background: "var(--red)" }}>
                      {notifCount > 9 ? "9+" : notifCount}
                    </div>
                  ) : null;
                })()}
              </div>
              <button type="button" className="btn-gold" onClick={() => setModal("intake")}>＋ New Matter</button>
              </>
              )}
            </div>
          </div>

          {notifOpen && (
            <div
              ref={notifRef}
              style={{
                position: "fixed",
                top: isMobile ? "calc(env(safe-area-inset-top, 0px) + 58px)" : 64,
                right: isMobile ? "max(8px, env(safe-area-inset-right, 0px))" : 16,
                left: isMobile ? "max(8px, env(safe-area-inset-left, 0px))" : "auto",
                width: isMobile ? "auto" : 380,
                maxWidth: isMobile ? "calc(100vw - 16px)" : 380,
                maxHeight: isMobile ? "min(75dvh, 520px)" : "80vh",
                background: "var(--white)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-xl)",
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                animation: "fadeUp 0.2s ease"
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0
                }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color: "var(--text)" }}>
                  Notifications
                  {notifications.length > 0 && (
                    <span
                      style={{
                        marginLeft: 8,
                        background: "var(--red)",
                        color: "white",
                        borderRadius: 20,
                        padding: "1px 8px",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)"
                      }}
                    >
                      {notifications.length}
                    </span>
                  )}
                </div>
                <button className="modal-close" onClick={() => setNotifOpen(false)}>✕</button>
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  background: "var(--gold-light)",
                  borderBottom: "1px solid var(--gold-dim)",
                  flexShrink: 0,
                  maxHeight: "200px",
                  overflowY: "auto"
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "1.5px",
                    marginBottom: 8
                  }}
                >
                  ✦ Suggested Next Actions
                </div>
                {notifLoading ? (
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>AI is analysing your notifications...</div>
                ) : notifAI ? (
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>
                    {notifAI}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>No urgent items right now</div>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
                    All caught up — no urgent notifications
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--border-2)",
                        cursor: "pointer",
                        transition: "background 0.12s",
                        borderLeft:
                          "3px solid " +
                          (n.urgency === "critical" ? "var(--red)" : n.urgency === "high" ? "var(--amber)" : "var(--border)")
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--white)")}
                      onClick={() => {
                        if (n.matter_ref) {
                          setSelectedMatter(n.matter_ref);
                          setPage("matter_workspace");
                          setMatterTab("Overview");
                          setNotifOpen(false);
                        }
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 18, flexShrink: 0 }}>{n.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color:
                                  n.urgency === "critical"
                                    ? "var(--red)"
                                    : n.urgency === "high"
                                      ? "var(--amber)"
                                      : "var(--text)"
                              }}
                            >
                              {n.title}
                            </span>
                            <span
                              className={`tag ${n.urgency === "critical" ? "tag-red" : n.urgency === "high" ? "tag-amber" : "tag-gray"}`}
                              style={{ fontSize: 9 }}
                            >
                              {n.urgency}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>{n.body}</div>
                          {n.matter_ref && (
                            <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-3)", marginTop: 3 }}>
                              {n.matter_ref}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div
                style={{
                  padding: "10px 16px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface)",
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                  Updates automatically
                </span>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    setNotifAI(null);
                    openNotifications();
                  }}
                >
                  ↺ Refresh
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              DASHBOARD
          ══════════════════════════════════════════════ */}
          {page === "dashboard" && (() => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayYMD = today.toISOString().split("T")[0];
            const hour = today.getHours();
            const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
            const dateStr = today.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
            const activeMatters = MATTERS.filter((m) => m.status === "active");
            const settlementsThisWeek = (calendarEvents || []).filter((e) => {
              if (e.event_type !== "settlement") return false;
              const d = new Date(e.date + "T00:00:00");
              const weekEnd = new Date(today);
              weekEnd.setDate(today.getDate() + 7);
              return d >= today && d <= weekEnd;
            }).length;
            const overdueCount = (tasks || []).filter((t) => !t.done && t.due_date && new Date(t.due_date + "T00:00:00") < today).length;
            const tasksDueTodayCount = (tasks || []).filter((t) => {
              if (t.done) return false;
              if (t.due_date && t.due_date === todayYMD) return true;
              if (t.due === "Today") return true;
              return false;
            }).length;
            const summaryLine = settlementsThisWeek > 0 || overdueCount > 0
              ? `You have ${settlementsThisWeek} settlement${settlementsThisWeek !== 1 ? "s" : ""} this week and ${overdueCount} overdue task${overdueCount !== 1 ? "s" : ""}.`
              : "No critical deadlines today. Use the pipeline to prioritise.";

            const criticalAlerts = [];
            (calendarEvents || []).filter((e) => e.event_type === "settlement").forEach((e) => {
              const d = new Date(e.date + "T00:00:00");
              const days = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
              if (days >= 0 && days <= 3) criticalAlerts.push({ icon: "🏠", text: `${e.title} in ${days} day${days !== 1 ? "s" : ""}`, type: "settlement" });
            });
            (tasks || []).filter((t) => !t.done && t.urgency === "critical").slice(0, 2).forEach((t) => {
              criticalAlerts.push({ icon: "⚠️", text: (t.client_name || t.client) + " — " + (t.task || "").slice(0, 40), type: "task" });
            });
            const hasCriticalAlerts = criticalAlerts.length > 0;

            const STAGES = [
              { key: "Intake", color: "#94a3b8" },
              { key: "Contract Review", color: "var(--amber)" },
              { key: "Contract Sent", color: "var(--blue)" },
              { key: "Searches Ordered", color: "#9333ea" },
              { key: "PEXA Ready", color: "var(--teal)" },
              { key: "Settled", color: "var(--green)" }
            ];
            const maxStageCount = Math.max(1, ...STAGES.map((s) => (MATTERS.filter((m) => (m.stage || "").trim() === s.key).length)));

            const upcomingSettlements = (calendarEvents || [])
              .filter((e) => e.event_type === "settlement")
              .map((e) => ({ ...e, d: new Date(e.date + "T00:00:00") }))
              .filter((e) => e.d >= today)
              .sort((a, b) => a.d - b.d)
              .slice(0, 15)
              .map((e) => ({ ...e, daysUntil: Math.ceil((e.d - today) / (1000 * 60 * 60 * 24)) }));

            const todayTasks = (tasks || []).filter((t) => {
              if (t.done) return false;
              if (t.due_date && t.due_date === todayYMD) return true;
              if (t.due === "Today") return true;
              if (t.urgency === "critical") return true;
              return false;
            });
            const todayTasksCritical = todayTasks.filter((t) => t.urgency === "critical");
            const todayTasksHigh = todayTasks.filter((t) => t.urgency === "high" && t.urgency !== "critical");
            const todayTasksRest = todayTasks.filter((t) => t.urgency !== "critical" && t.urgency !== "high");
            const todayTasksOrdered = [...todayTasksCritical, ...todayTasksHigh, ...todayTasksRest];

            const recentMatters = [...MATTERS].sort((a, b) => new Date(b.opened || b.opened_date || 0) - new Date(a.opened || a.opened_date || 0)).slice(0, 5);

            const weekStart = new Date(today);
            const dayNum = weekStart.getDay();
            const diff = (dayNum + 6) % 7;
            weekStart.setDate(weekStart.getDate() - diff);
            const weekDays = [];
            for (let i = 0; i < 7; i++) {
              const d = new Date(weekStart);
              d.setDate(weekStart.getDate() + i);
              weekDays.push(d);
            }

            const pipelineValue = activeMatters.reduce((s, m) => s + (parseFloat(String(m.price || m.value || 0).replace(/[^0-9.]/g, "")) || 0), 0);
            const xeroPl = xeroData?.financialYear?.report ? parseXeroProfitAndLoss(xeroData.financialYear.report) : null;
            const xeroHasPl = Boolean(xeroData?.financialYear?.report);

            const typeOrder = ["Purchase", "Sale", "Lease", "Contract Review", "General Enquiry", "Other"];
            const typeCounts = {};
            (MATTERS || []).forEach((m) => {
              const t = (m.type || "Other").trim();
              const key = typeOrder.includes(t) ? t : "Other";
              typeCounts[key] = (typeCounts[key] || 0) + 1;
            });
            typeOrder.forEach((t) => { if (!typeCounts[t]) typeCounts[t] = 0; });
            const typeTotal = Object.values(typeCounts).reduce((a, b) => a + b, 0) || 1;
            const typeColors = { Purchase: "var(--teal)", Sale: "var(--amber)", Lease: "var(--purple)", "Contract Review": "var(--blue)", "General Enquiry": "var(--text-3)", Other: "var(--text-3)" };

            const topReferrers = (contacts || []).filter((c) => c.is_referrer).slice(0, 3);
            const referrersToShow = topReferrers.length > 0 ? topReferrers : (referrers || []).slice(0, 3);

            return (
              <div className="content">
                <div className="dash-hero fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 20 }}>
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div className="dash-greeting">{greeting}, Gitu.</div>
                    <div className="dash-date">{dateStr}</div>
                    <div className="dash-summary">{summaryLine}</div>
                  </div>
                  <div className="dash-hero-stats" style={{ position: "relative", zIndex: 1 }}>
                    <div><div className="dash-hero-stat-val">{activeMatters.length}</div><div className="dash-hero-stat-label">Active Matters</div></div>
                    <div><div className="dash-hero-stat-val">{settlementsThisWeek}</div><div className="dash-hero-stat-label">Settlements This Week</div></div>
                    <div><div className="dash-hero-stat-val">{tasksDueTodayCount}</div><div className="dash-hero-stat-label">Tasks Due Today</div></div>
                    <div><div className="dash-hero-stat-val">0</div><div className="dash-hero-stat-label">Unread Emails</div></div>
                  </div>
                </div>

                {hasCriticalAlerts && (
                  <div className="dash-alerts fade-up-1">
                    {criticalAlerts.slice(0, 3).map((a, i) => (
                      <div key={i} className="dash-alert-pill">
                        <span>{a.icon}</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{a.text}</span>
                        <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => { setPage("calendar"); if (a.type === "settlement") setPage("matters"); }}>Act Now →</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Three stat cards row - Financial, Matter Mix, Referral Partners */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                  <div className="card fade-up-1" style={{ background: "var(--white)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", padding: "16px 20px", boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>Financial Overview</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 24px" }}>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", marginBottom: 2 }}>Active Pipeline</div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text)" }}>${(pipelineValue / 1000).toFixed(0)}K</div>
                      </div>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", marginBottom: 2 }}>Income YTD</div>
                        {xeroHasPl && xeroPl ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--green)" }}>{formatXeroMoney(xeroPl.totalIncome ?? 0)}</div>
                        ) : xeroLoading ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text-3)" }}>…</div>
                        ) : xeroData ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text-3)" }}>—</div>
                        ) : (
                          <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: "2px 0", color: "var(--blue)" }} onClick={() => { window.location.href = "/api/xero/auth"; }}>Connect Xero</button>
                        )}
                      </div>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", marginBottom: 2 }}>Expenses YTD</div>
                        {xeroHasPl && xeroPl ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--red)" }}>{formatXeroMoney(xeroPl.totalExpenses ?? 0)}</div>
                        ) : xeroLoading ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text-3)" }}>…</div>
                        ) : xeroData ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text-3)" }}>—</div>
                        ) : (
                          <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: "2px 0", color: "var(--blue)" }} onClick={() => { window.location.href = "/api/xero/auth"; }}>Connect Xero</button>
                        )}
                      </div>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", marginBottom: 2 }}>Net Profit</div>
                        {xeroHasPl && xeroPl ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: (xeroPl.netProfit ?? 0) >= 0 ? "var(--blue)" : "var(--red)" }}>{formatXeroMoney(xeroPl.netProfit ?? 0)}</div>
                        ) : xeroLoading ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text-3)" }}>…</div>
                        ) : xeroData ? (
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--text-3)" }}>—</div>
                        ) : (
                          <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: "2px 0", color: "var(--blue)" }} onClick={() => { window.location.href = "/api/xero/auth"; }}>Connect Xero</button>
                        )}
                      </div>
                    </div>
                    <button type="button" className="btn-ghost" style={{ fontSize: 10, marginTop: 8, padding: 0 }} onClick={() => setPage("accounting")}>View Accounting →</button>
                  </div>

                  <div className="card fade-up-1" style={{ background: "var(--white)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", padding: "16px 20px", boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 10 }}>Matter Mix</div>
                    <div style={{ height: 10, borderRadius: 10, overflow: "hidden", display: "flex", background: "var(--surface)", marginBottom: 10 }}>
                      {typeOrder.filter((t) => (typeCounts[t] || 0) > 0).map((t) => (
                        <div key={t} style={{ width: `${((typeCounts[t] || 0) / typeTotal) * 100}%`, background: typeColors[t] || typeColors.Other, transition: "width 0.3s ease" }} title={`${t}: ${typeCounts[t]}`} />
                      ))}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 16px" }}>
                      {typeOrder.filter((t) => (typeCounts[t] || 0) > 0).map((t) => (
                        <div key={t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: typeColors[t] || typeColors.Other, flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: "var(--text-2)" }}>{t}</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>{typeCounts[t]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card fade-up-1" style={{ background: "var(--white)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", padding: "16px 20px", boxShadow: "var(--shadow-sm)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1px" }}>Referral Partners</div>
                      <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: 0 }} onClick={() => setPage("referrals")}>View all →</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {referrersToShow.map((r) => {
                        const name = r.name || "";
                        const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
                        const count = r.referrals != null ? r.referrals : 0;
                        return (
                          <div key={r.id || name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--blue-light)", color: "var(--blue)", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials}</div>
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                            <span className="tag tag-gray" style={{ fontSize: 9 }}>{count}</span>
                          </div>
                        );
                      })}
                      {referrersToShow.length === 0 && <div style={{ fontSize: 11, color: "var(--text-3)" }}>No referrers</div>}
                    </div>
                  </div>
                </div>

                <div className="dash-main-grid">
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div className="card fade-up-2">
                      <div className="card-hdr">
                        <div className="card-title">Matter Pipeline</div>
                      </div>
                      <div className="pipeline-stages">
                        {STAGES.map((s) => {
                          const count = MATTERS.filter((m) => (m.stage || "").trim() === s.key).length;
                          return (
                            <div key={s.key} className="pipeline-stage-row" onClick={() => setPage("matters")}>
                              <span className="pipeline-stage-name">{s.key.replace(/\s+/g, " ")}</span>
                              <span className="pipeline-stage-count">{count}</span>
                              <div className="pipeline-stage-bar-wrap">
                                <div className="pipeline-stage-bar" style={{ width: `${(count / maxStageCount) * 100}%`, background: s.color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="card fade-up-3">
                      <div className="card-hdr">
                        <div className="card-title">Upcoming Settlements</div>
                        <div className="card-sub">Next 30 days</div>
                      </div>
                      <div style={{ padding: "4px 20px 14px" }}>
                        {upcomingSettlements.length === 0 ? (
                          <div style={{ textAlign: "center", padding: 20, color: "var(--text-3)", fontSize: 12 }}>
                            <div style={{ marginBottom: 10 }}>No settlements scheduled — scan emails to find dates</div>
                            <button type="button" className="btn-gold" style={{ fontSize: 12 }} onClick={scanEmailsForEvents}>✦ Scan Emails</button>
                          </div>
                        ) : (
                          upcomingSettlements.map((e) => (
                            <div
                              key={e.id}
                              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-2)", cursor: "pointer" }}
                              onClick={() => { setSelectedMatter(e.matter_ref); setPage("matter_workspace"); setMatterTab("Overview"); }}
                            >
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: e.daysUntil <= 7 ? 700 : 400, color: e.daysUntil <= 3 ? "var(--red)" : "var(--text-2)", minWidth: 72 }}>
                                {e.date}
                              </span>
                              <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{e.client_name || e.title}</span>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>{e.matter_ref}</span>
                              <span className={`tag ${e.daysUntil <= 3 ? "tag-red" : e.daysUntil <= 7 ? "tag-amber" : "tag-green"}`} style={{ fontSize: 9 }}>{e.daysUntil}d</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div className="card fade-up-2">
                      <div className="card-hdr">
                        <div className="card-title">Today&apos;s Tasks</div>
                        <span className="tag tag-red">{todayTasksOrdered.filter((t) => !t.done).length} due</span>
                      </div>
                      <div style={{ padding: "4px 20px 14px" }}>
                        {todayTasksOrdered.length === 0 ? (
                          <div style={{ fontSize: 12, color: "var(--text-3)", padding: 12 }}>No tasks due today</div>
                        ) : (
                          todayTasksOrdered.map((t) => (
                            <div key={t.id} className="task-item" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-2)" }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: URGENCY_COLOR[t.urgency] || "#94a3b8", flexShrink: 0, marginTop: 6 }} />
                              <div className={`task-check ${t.done ? "done" : ""}`} style={{ width: 18, height: 18, borderRadius: 4, border: "2px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }} onClick={() => setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}>{t.done && "✓"}</div>
                              <div className="task-body" style={{ flex: 1, minWidth: 0 }}>
                                <div className={`task-text ${t.done ? "done-text" : ""}`} style={{ textDecoration: t.done ? "line-through" : "none", fontSize: 12 }}>{t.task}</div>
                                <div className="task-meta" style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{(t.client_name || t.client)} · {(t.matter_ref || t.matter)}</div>
                              </div>
                            </div>
                          ))
                        )}
                        <div style={{ marginTop: 10 }}>
                          <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setPage("matters")}>View all tasks →</button>
                        </div>
                      </div>
                    </div>

                    <div className="card fade-up-3">
                      <div className="card-hdr">
                        <div className="card-title">Recent Matters</div>
                      </div>
                      <div style={{ padding: "4px 20px 14px" }}>
                        {recentMatters.map((m) => {
                          const opened = m.opened || m.opened_date;
                          const daysOpen = opened ? Math.floor((today - new Date(opened)) / (1000 * 60 * 60 * 24)) : null;
                          return (
                            <div key={m.matter_ref || m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-2)", cursor: "pointer" }} onClick={() => { setSelectedMatter(m.matter_ref || m.id); setPage("matter_workspace"); setMatterTab("Overview"); }}>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", width: 90 }}>{m.matter_ref || m.id}</span>
                              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{m.client_name || m.client}</span>
                              <span className={`tag ${m.type === "Purchase" ? "tag-teal" : m.type === "Sale" ? "tag-amber" : "tag-gray"}`} style={{ fontSize: 9 }}>{m.type}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: STAGES.find((s) => s.key === m.stage)?.color || "#94a3b8" }} />
                                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{m.stage}</span>
                              </div>
                              {daysOpen != null && <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{daysOpen}d</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
                    {/* Compact mini calendar - above unified panel */}
                    <div className="card fade-up-2" style={{ flexShrink: 0 }}>
                      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1.5px" }}>This Week</div>
                        <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => setPage("calendar")}>Calendar →</button>
                      </div>
                      <div className="mini-cal-grid" style={{ padding: 8 }}>
                        {weekDays.map((d) => {
                          const ymd = d.toISOString().split("T")[0];
                          const isToday = ymd === todayYMD;
                          const dayEvents = (calendarEvents || []).filter((e) => (e.date || "").slice(0, 10) === ymd);
                          const eventColors = dayEvents.slice(0, 3).map((ev) => EVENT_COLORS[ev.event_type]?.dot || "#94a3b8");
                          const extra = dayEvents.length > 3 ? dayEvents.length - 3 : 0;
                          return (
                            <div key={ymd} className={`mini-cal-day ${isToday ? "today" : ""}`} style={{ padding: "4px 2px" }} onClick={() => { setCalendarDate(d); setPage("calendar"); }}>
                              <div className="mini-cal-day-name" style={{ marginBottom: 2 }}>{d.toLocaleDateString("en-AU", { weekday: "short" }).slice(0, 3)}</div>
                              <div className="mini-cal-day-num" style={{ fontSize: 12, width: 22, height: 22, marginBottom: 2 }}>{d.getDate()}</div>
                              <div className="mini-cal-dots" style={{ minHeight: 6 }}>
                                {eventColors.map((c, i) => <div key={i} className="mini-cal-dot" style={{ background: c, width: 4, height: 4 }} />)}
                                {extra > 0 && <span style={{ fontSize: 7, color: "var(--text-3)" }}>+{extra}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* AI Co-pilot — fixed layout: scroll area has explicit height so it always scrolls */}
                    <div className="card fade-up-2" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                      <div
                        style={{
                          height: "580px",
                          display: "flex",
                          flexDirection: "column",
                          background: "var(--ink)",
                          borderRadius: "var(--radius-lg)",
                          position: "relative",
                          overflow: "hidden",
                          ...(isMobile ? { minHeight: 400 } : {})
                        }}
                      >
                        <div style={{ position: "absolute", top: 0, right: 0, width: 200, height: 200, background: "radial-gradient(circle,rgba(36,94,176,0.15) 0%,transparent 70%)", pointerEvents: "none" }} />
                        {/* Header — fixed */}
                        <div style={{ padding: isMobile ? "12px 14px" : "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0, position: "relative", zIndex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <div>
                              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "2px", marginBottom: 2 }}>✦ Crew Intelligence</div>
                              <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 500, color: "white" }}>AI Co-pilot</div>
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.5)" }} />
                              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.35)" }}>ACTIVE</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {[
                              { icon: "📅", label: "Scan Emails", action: () => scanEmailsForEvents() },
                              { icon: "⚖️", label: "Matters", action: () => setPage("matters") },
                              { icon: "✉️", label: "Emails", action: () => setPage("communications") },
                              { icon: "📋", label: "Calendar", action: () => setPage("calendar") }
                            ].map((btn) => (
                              <button
                                key={btn.label}
                                type="button"
                                style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "5px 10px", fontSize: 10, color: "rgba(255,255,255,0.7)", cursor: "pointer", fontFamily: "var(--font-body)" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "white"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
                                onClick={btn.action}
                              >
                                <span>{btn.icon}</span>{btn.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Morning brief / loading — fixed */}
                        {dashMorningBrief && (
                          <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, maxHeight: "120px", overflowY: "auto" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Morning Brief</span>
                              <button type="button" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", background: "none", border: "none", cursor: "pointer" }} onClick={() => generateMorningBrief()}>↺</button>
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{dashMorningBrief}</div>
                          </div>
                        )}
                        {dashBriefLoading && (
                          <div style={{ padding: "10px 18px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Generating morning brief…</span>
                          </div>
                        )}
                        {/* Messages — FIXED HEIGHT scroll box (this is what makes scrolling work) */}
                        <div
                          className="dash-ai-messages"
                          style={{
                            height: "300px",
                            overflowY: "scroll",
                            overflowX: "hidden",
                            padding: "12px 16px",
                            scrollbarWidth: "thin",
                            scrollbarColor: "rgba(255,255,255,0.45) rgba(0,0,0,0.2)"
                          }}
                        >
                          {dashAIChat.length === 0 && !dashMorningBrief && !dashBriefLoading && (
                            <div style={{ textAlign: "center", padding: "24px 12px", color: "rgba(255,255,255,0.25)", fontSize: 12, lineHeight: 1.6 }}>
                              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>✦</div>
                              Ask me anything about your practice, matters, tasks or upcoming events.
                            </div>
                          )}
                          {dashAIChat.map((m, i) => (
                            <div key={i} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
                              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: m.role === "user" ? "linear-gradient(135deg,var(--blue),#1a4a9e)" : "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.15)" }}>
                                {m.role === "user" ? "You" : "✦"}
                              </div>
                              <div style={{ maxWidth: "85%", padding: "8px 12px", borderRadius: m.role === "user" ? "10px 4px 10px 10px" : "4px 10px 10px 10px", fontSize: 11, lineHeight: 1.7, background: m.role === "user" ? "rgba(36,94,176,0.35)" : "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.1)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {m.text}
                              </div>
                            </div>
                          ))}
                          {dashAITyping && (
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
                              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>✦</div>
                              <div style={{ padding: "8px 12px", borderRadius: "4px 10px 10px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                                <div className="ai-typing"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
                              </div>
                            </div>
                          )}
                          <div ref={aiEndRef} />
                        </div>
                        {/* Prompt bar — fixed at bottom */}
                        <div style={{ flexShrink: 0, padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                            {["What needs attention today?", "Any settlements this week?", "Overdue tasks?", "Summarise my pipeline"].map((q) => (
                              <button
                                key={q}
                                type="button"
                                style={{ fontSize: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "4px 10px", color: "rgba(255,255,255,0.75)", cursor: "pointer", fontFamily: "var(--font-body)" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; e.currentTarget.style.color = "white"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
                                onClick={() => sendDashAI(q)}
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "9px 12px", fontSize: 11, color: "rgba(255,255,255,0.9)", outline: "none", fontFamily: "var(--font-body)" }}
                              placeholder="Ask about your practice..."
                              value={dashAIChatInput}
                              onChange={(e) => setDashAIChatInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && sendDashAI()}
                            />
                            <button
                              type="button"
                              style={{ background: "linear-gradient(135deg,var(--blue),#1a4a9e)", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                              onClick={() => sendDashAI()}
                            >
                              Send
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ══════════════════════════════════════════════
              MATTERS LIST
          ══════════════════════════════════════════════ */}
          {page === "matters" && !selectedMatter && (
            <div className="content">
              {mattersLoading ? (
                <div className="matter-table fade-up-2">
                  <div style={{padding:20,textAlign:"center",color:"var(--text-2)"}}>
                    Loading matters...
                  </div>
                </div>
              ) : (
                <>
                  <div className="stat-row fade-up">
                    {[
                      {label:"Total Active",value:activeM.length,sub:"matters",cls:""},
                      {label:"High Urgency",value:MATTERS.filter(m=>m.urgency==="high"&&m.status==="active").length,sub:"needs attention",cls:"stat-red"},
                      {label:"Due This Week",value:"2",sub:"deadlines",cls:"stat-gold"},
                      {label:"Settled YTD",value:closedM.length,sub:"completed",cls:"stat-accent"},
                      {label:"Pipeline Value",value:"$5.22M",sub:"active matters",cls:"stat-gold"},
                    ].map(s=>(
                      <div key={s.label} className={`stat ${s.cls}`}>
                        <div className="stat-label">{s.label}</div>
                        <div className="stat-value">{s.value}</div>
                        <div className="stat-sub">{s.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div className="filter-bar fade-up-1">
                    {["all","active","closed"].map(f=>(
                      <button key={f} className={`filter-btn ${mFilter===f?"active":""}`} onClick={()=>setMFilter(f)}>
                        {f==="all"?`All (${MATTERS.length})`:f==="active"?`Active (${activeM.length})`:`Closed (${closedM.length})`}
                      </button>
                    ))}
                    <div className="filter-sep"/>
                    <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px"}}>↓ Export</button>
                    <button className="btn-gold" onClick={()=>setModal("intake")}>＋ New Matter</button>
                  </div>
                  {isMobile ? (
                    <div className="fade-up-2" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 0 20px" }}>
                      {(mFilter==="all"?MATTERS:mFilter==="active"?activeM:closedM).map(m=>(
                        <div key={m.id} className="card" style={{ cursor: "pointer", padding: 14 }} onClick={()=>{ setSelectedMatter(m.id); setPage("matter_workspace"); setMatterTab("Overview"); }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{m.client_name || m.client}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>{m.address}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                            <span className={`tag ${m.type==="Purchase"?"tag-teal":m.type==="Sale"?"tag-amber":m.type==="Lease"?"tag-purple":m.type==="Contract Review"?"tag-blue":"tag-gray"}`} style={{ fontSize: 10 }}>{m.type}</span>
                            <span className={`tag ${m.state==="NSW"?"tag-blue":"tag-purple"}`} style={{ fontSize: 10 }}>{m.stage}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>Settlement: {fmt(m.settlement_date || m.settlement)} · {m.price}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                  <div className="matter-table fade-up-2">
                    <div className="mt-thead">
                      {["Matter ID","Client / Address","Type","Stage","Value","Staff"].map(h=><div key={h} className="mt-th">{h}</div>)}
                    </div>
                    {(mFilter==="all"?MATTERS:mFilter==="active"?activeM:closedM).map(m=>(
                      <div key={m.id} className="mt-row" style={{cursor:"pointer"}}
                        onClick={()=>{setSelectedMatter(m.id);setPage("matter_workspace");setMatterTab("Overview");}}>
                        <div className="mt-id">{m.id}</div>
                        <div>
                          <div className="mt-client">{m.client}</div>
                          <div className="mt-addr">{m.address}</div>
                        </div>
                        <div>
                          <span className={`tag ${m.type==="Purchase"?"tag-teal":m.type==="Sale"?"tag-amber":m.type==="Lease"?"tag-purple":m.type==="Contract Review"?"tag-blue":"tag-gray"}`}>{m.type}</span>
                          <div style={{marginTop:3}}><span className={`tag ${m.state==="NSW"?"tag-blue":"tag-purple"}`}>{m.state}</span></div>
                        </div>
                        <div className="mt-stage">
                          <div className="stage-dot" style={{background:STAGE_COLORS[m.stage]||"#94a3b8"}}/>
                          {m.stage}
                        </div>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text)",fontFamily:"var(--font-mono)"}}>{m.price}</div>
                        <div style={{fontSize:12,color:"var(--text-2)"}}>{m.staff}</div>
                      </div>
                    ))}
                  </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Matter detail modal */}
          {viewingMatterInModal && (()=>{
            const modalMatter = MATTERS.find(m=>m.id===viewingMatterInModal);
            if(!modalMatter) return null;
            return (
              <div className="contact-modal-overlay" style={{zIndex:1001}} onClick={()=>setViewingMatterInModal(null)}>
                <div ref={matterModalRef} className="contact-modal" onClick={e=>e.stopPropagation()} style={{...matterModalSize,position:"relative"}}>
                  <div className="contact-modal-hdr">
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"var(--font-display)",fontSize:18,fontWeight:600,color:"var(--text)"}}>{modalMatter.id}</div>
                      <div style={{fontSize:13,color:"var(--text-2)",marginTop:2}}>{modalMatter.client} · {modalMatter.type}</div>
                    </div>
                    <button type="button" className="btn-ghost" style={{fontSize:12}} onClick={()=>{ setSelectedMatter(modalMatter.id); setPage("matter_workspace"); setMatterTab("Overview"); setViewingMatterInModal(null); }}>Open full view →</button>
                    <button type="button" className="modal-close" onClick={()=>setViewingMatterInModal(null)}>✕</button>
                  </div>
                  <div className="ws-tabs" style={{padding:"0 24px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
                    {["Overview","Workflow","Timeline","Documents","Searches","Tasks","Communications","Billing","AI Assistant"].map(t=>(
                      <button key={t} className={`ws-tab ${matterModalTab===t?"active":""}`} style={{fontSize:12,padding:"10px 14px"}} onClick={()=>setMatterModalTab(t)}>{t}</button>
                    ))}
                  </div>
                  <div style={{flex:1,overflow:"auto",padding:24,minHeight:0}}>
                    {matterModalTab==="Overview" && (
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                        <div className="card">
                          <div className="card-hdr"><div className="card-title">Key Details</div></div>
                          <div style={{padding:"8px 18px 14px"}}>
                            {[["Matter Type",modalMatter.type],["Status",modalMatter.stage],["Settlement",fmt(modalMatter.settlement)],["Property Value",modalMatter.price],["Staff",modalMatter.staff],["State",modalMatter.state]].map(([k,v])=>(
                              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border-2)",fontSize:12,gap:8}}>
                                <span style={{color:"var(--text-3)"}}>{k}</span>
                                <span style={{fontWeight:600,color:"var(--text)",textAlign:"right"}}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="card">
                          <div className="card-hdr"><div className="card-title">⚠ Outstanding Actions</div></div>
                          <div style={{padding:"6px 16px 12px"}}>
                            {tasks.filter(t=>!t.done&&t.matter===modalMatter.id).map(t=>(
                              <div key={t.id} style={{display:"flex",gap:8,padding:"7px 0",borderBottom:"1px solid var(--border-2)",alignItems:"flex-start",fontSize:11}}>
                                <div style={{width:6,height:6,borderRadius:"50%",background:URGENCY_COLOR[t.urgency],marginTop:3,flexShrink:0}}/>
                                <div style={{flex:1,color:"var(--text)"}}>{t.task}</div>
                                <span style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{t.due}</span>
                              </div>
                            ))}
                            {tasks.filter(t=>!t.done&&t.matter===modalMatter.id).length===0&&<div style={{fontSize:12,color:"var(--text-3)",padding:"8px 0"}}>✓ All tasks complete</div>}
                          </div>
                        </div>
                      </div>
                    )}
                    {matterModalTab!=="Overview" && (
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:48,color:"var(--text-3)",fontSize:14}}>
                        <div style={{marginBottom:16}}>Full {matterModalTab} tab available in full view.</div>
                        <button type="button" className="btn-gold" style={{fontSize:12}} onClick={()=>{ setSelectedMatter(modalMatter.id); setPage("matter_workspace"); setMatterTab(matterModalTab); setViewingMatterInModal(null); }}>Open full view →</button>
                      </div>
                    )}
                  </div>
                  <div style={{position:"absolute",bottom:4,right:4,width:12,height:12,cursor:"se-resize",borderRight:"2px solid var(--border)",borderBottom:"2px solid var(--border)",borderRadius:"0 0 4px 0"}} onMouseDown={handleMatterModalResize}/>
                </div>
              </div>
            );
          })()}

          {/* ══════════════════════════════════════════════
              MATTER WORKSPACE
          ══════════════════════════════════════════════ */}
          {page === "matter_workspace" && selMatterObj && (
            <div className="workspace">
              <div className="ws-header">
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10}}>
                  <div>
                    <div className="ws-matter-id">{selMatterObj.id} · Opened {fmt(selMatterObj.opened)}</div>
                    <div className="ws-client">{selMatterObj.client}</div>
                    <div className="ws-address">📍 {selMatterObj.address}</div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <span className={`tag ${selMatterObj.type==="Purchase"?"tag-teal":selMatterObj.type==="Sale"?"tag-amber":selMatterObj.type==="Lease"?"tag-purple":selMatterObj.type==="Contract Review"?"tag-blue":"tag-gray"}`}>{selMatterObj.type}</span>
                    <span className="tag" style={{background:(STAGE_COLORS[selMatterObj.stage]||"#94a3b8")+"22",color:STAGE_COLORS[selMatterObj.stage]||"#94a3b8"}}>{selMatterObj.stage}</span>
                    <span className="tag tag-gray">{selMatterObj.price}</span>
                    {selMatterObj.urgency==="high"&&<span className="tag tag-red">⚡ High Priority</span>}
                    <button
                      type="button"
                      className="btn-primary"
                      style={{fontSize:12,display:"inline-flex",alignItems:"center",gap:6}}
                      onClick={()=>window.open(selMatterObj.pexa?.workspaceId ? `https://www.pexa.com.au/workspaces/${selMatterObj.pexa.workspaceId}` : "https://www.pexa.com.au","_blank")}
                    >
                      🏦 Open in PEXA
                      {selMatterObj.pexa?.workspaceId&&<span className="tag" style={{fontSize:9,padding:"2px 6px",background:"rgba(255,255,255,0.2)",marginLeft:2}}>Workspace: {selMatterObj.pexa.workspaceId}</span>}
                    </button>
                  </div>
                </div>
                <div className="ws-tabs">
                  {["Overview","Workflow","Timeline","Documents","Searches","Tasks","Communications","Billing","AI Assistant"].map(t=>(
                    <button
                      key={t}
                      className={`ws-tab ${matterTab===t?"active":""}`}
                      onClick={()=>{
                        setMatterTab(t)
                        if (t==="Communications") {
                          setMattersCommsModal(true)
                          fetchMattersCommsEmails()
                        }
                      }}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div className="ws-content">

                {/* OVERVIEW */}
                {matterTab==="Overview" && (
                  <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",gap: isMobile ? 12 : 16}}>
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">Key Details</div></div>
                      <div style={{padding:"8px 18px 14px"}}>
                        {[
                          ["Matter Type",selMatterObj.type],["Status",selMatterObj.stage],
                          ["Settlement",fmt(selMatterObj.settlement)],["Property Value",selMatterObj.price],
                          ["Staff",selMatterObj.staff],["State",selMatterObj.state],
                          ["Lender",selMatterObj.lender],["Deposit",selMatterObj.deposit+" "+(selMatterObj.depositPaid?"✓ Paid":"⚠ Unpaid")],
                          ["Agent",selMatterObj.agent],["Phone",selMatterObj.agentPhone],
                        ].map(([k,v])=>(
                          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border-2)",fontSize:12,gap:8}}>
                            <span style={{color:"var(--text-3)"}}>{k}</span>
                            <span style={{fontWeight:600,color:"var(--text)",textAlign:"right"}}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div className="card">
                        <div className="card-hdr"><div className="card-title">⚠ Outstanding Actions</div></div>
                        <div style={{padding:"6px 16px 12px"}}>
                          {tasks.filter(t=>!t.done&&t.matter===selMatterObj.id).map(t=>(
                            <div key={t.id} style={{display:"flex",gap:8,padding:"7px 0",borderBottom:"1px solid var(--border-2)",alignItems:"flex-start",fontSize:11}}>
                              <div style={{width:6,height:6,borderRadius:"50%",background:URGENCY_COLOR[t.urgency],marginTop:3,flexShrink:0}}/>
                              <div style={{flex:1,color:"var(--text)"}}>{t.task}</div>
                              <span style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{t.due}</span>
                            </div>
                          ))}
                          {tasks.filter(t=>!t.done&&t.matter===selMatterObj.id).length===0&&(
                            <div style={{fontSize:12,color:"var(--text-3)",padding:"8px 0"}}>✓ All tasks complete</div>
                          )}
                        </div>
                      </div>
                      <div className="card">
                        <div className="card-hdr"><div className="card-title">🔍 Searches</div></div>
                        <div style={{padding:"8px 16px 12px"}}>
                          {selMatterObj.searches
                            ? Object.entries(selMatterObj.searches).map(([k,v])=>(
                                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border-2)",fontSize:11}}>
                                  <span style={{color:"var(--text-2)",textTransform:"capitalize"}}>{k} Search</span>
                                  <span className={`tag ${v==="done"?"tag-green":v==="pending"?"tag-amber":"tag-gray"}`}>{v==="n/a"?"N/A":v}</span>
                                </div>
                              ))
                            : (
                              <div style={{fontSize:12,color:"var(--text-3)",padding:"6px 0",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                                <span>No searches recorded yet</span>
                                <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}}>Order Searches</button>
                              </div>
                            )
                          }
                        </div>
                      </div>
                      <div className="card">
                        <div className="card-hdr"><div className="card-title">Special Conditions</div></div>
                        <div style={{padding:"10px 16px",fontSize:12,color:"var(--text-2)",lineHeight:1.7,background:"#fffbeb",borderRadius:"0 0 var(--radius-lg) var(--radius-lg)",borderTop:"1px solid #fde68a"}}>
                          {selMatterObj.specialConditions}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* WORKFLOW */}
                {matterTab==="Workflow" && (() => {
                  // Map matter type to workflow key
                  const typeMap = {
                    "Purchase":"Purchase","Sale":"Sale",
                    "Lease":"Lease","Contract Review":"Contract Review","General Enquiry":"General Enquiry"
                  };
                  const wfKey = typeMap[selMatterObj.type] || "Purchase";
                  const phases = WORKFLOWS[wfKey] || [];
                  // Determine current phase index based on stage
                  const stageToPhaseIdx = {
                    "Intake":0,"Contract Review":1,"Contract Sent":2,
                    "Searches Ordered":3,"PEXA Ready":4,"Settled":5
                  };
                  const currentPhaseIdx = stageToPhaseIdx[selMatterObj.stage] ?? 0;

                  return (
                    <div className="wf-container">
                      <div className="wf-header">
                        <div className="wf-title">{wfKey} Workflow</div>
                        <div className="wf-subtitle">{selMatterObj.client} · {selMatterObj.id} · Current stage: {selMatterObj.stage}</div>
                      </div>

                      {/* Progress bar */}
                      <div className="wf-progress">
                        {phases.map((p,i)=>(
                          <div key={p.id} className={`wf-prog-step ${i===currentPhaseIdx?"current":i<currentPhaseIdx?"completed":""}`}>
                            {i<currentPhaseIdx && <div style={{position:"absolute",top:6,right:6,width:8,height:8,borderRadius:"50%",background:"var(--teal)",fontSize:7,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>✓</div>}
                            <div className="wf-prog-icon">{p.icon}</div>
                            <div className="wf-prog-label">{p.phase}</div>
                          </div>
                        ))}
                      </div>

                      {/* Phase cards */}
                      {phases.map((phase, phaseIdx) => (
                        <div key={phase.id} className="wf-phase">
                          <div className="wf-card" style={{borderLeft:`3px solid ${phaseIdx===currentPhaseIdx?phase.color:phaseIdx<currentPhaseIdx?"var(--teal)":"var(--border)"}`}}>
                            <div className="wf-card-hdr">
                              <div className="wf-phase-icon" style={{background:phase.colorLight}}>
                                {phase.icon}
                              </div>
                              <div style={{flex:1}}>
                                <div className="wf-phase-name">{phase.phase}</div>
                                <div className="wf-phase-meta">⏱ {phase.time} · {phase.channel}</div>
                              </div>
                              <div className="wf-phase-badge">
                                {phaseIdx < currentPhaseIdx
                                  ? <span className="tag tag-green">✓ Complete</span>
                                  : phaseIdx === currentPhaseIdx
                                  ? <span className="tag tag-gold">◉ In Progress</span>
                                  : <span className="tag tag-gray">Pending</span>
                                }
                              </div>
                            </div>
                            <div className="wf-steps">
                              {phase.steps.map((step,si)=>(
                                <div key={si} className="wf-step">
                                  <div className="wf-step-dot" style={{background:phaseIdx<currentPhaseIdx?"var(--teal)":phaseIdx===currentPhaseIdx?phase.color:"var(--border)"}}/>
                                  <div style={{flex:1}}>
                                    <div className="wf-step-label">{step.label}</div>
                                    <div className="wf-step-meta">⏱ {step.time} · 🔧 {step.tool}</div>
                                  </div>
                                  {phaseIdx < currentPhaseIdx && <span style={{fontSize:12,color:"var(--teal)"}}>✓</span>}
                                </div>
                              ))}
                              {phase.after && phase.after.map((step,si)=>(
                                <div key={"a"+si} className="wf-step">
                                  <div className="wf-step-dot" style={{background:phase.color,opacity:0.6}}/>
                                  <div style={{flex:1}}>
                                    <div className="wf-step-label">{step.label}</div>
                                    <div className="wf-step-meta">⏱ {step.time} · 🔧 {step.tool}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {phase.branches && (
                              <div className="wf-branches">
                                {phase.branches.map((b,bi)=>(
                                  <div key={bi} className="wf-branch">
                                    <div className="wf-branch-icon">{b.icon}</div>
                                    <div>
                                      <div className="wf-branch-label">{b.label}</div>
                                      {b.desc && <div className="wf-branch-desc">{b.desc}</div>}
                                      {b.time && <div className="wf-branch-time">⏱ {b.time}</div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {phaseIdx < phases.length - 1 && (
                            <div className="wf-connector">
                              <div className="wf-connector-arrow">▼</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* TIMELINE */}
                {matterTab==="Timeline" && (
                  <div style={{maxWidth:680}}>
                    {[
                      {icon:"✉️",color:"#eff6ff",dot:"#1d4ed8",type:"email",title:"Email received — "+selMatterObj.client,text:"Client enquiry received and matter opened. Initial documents requested.",date:"9:14 AM, "+fmt(selMatterObj.opened),author:""},
                      {icon:"📎",color:"#fdf4ff",dot:"#9333ea",type:"doc",title:"Document uploaded — Title Search",text:"Title search report received and filed to matter documents.",date:fmt(selMatterObj.opened),author:"J. Chen"},
                      {icon:"✅",color:"#f0fdf4",dot:"#16a34a",type:"task",title:"Stage advanced — "+selMatterObj.stage,text:"Matter progressed to current stage. All prior checks completed.",date:fmt(selMatterObj.opened),author:"J. Chen"},
                      {icon:"📝",color:"#fefce8",dot:"#ca8a04",type:"note",title:"Note added",text:selMatterObj.notes,date:fmt(selMatterObj.opened),author:"J. Chen"},
                    ].map((e,i)=>(
                      <div key={i} className="timeline-item">
                        <div className="tl-dot" style={{background:e.color,border:`2px solid ${e.dot}`}}>{e.icon}</div>
                        <div className="tl-body">
                          <div className="tl-meta"><span style={{color:e.dot,fontWeight:600}}>{e.type.toUpperCase()}</span>· {e.date}{e.author&&` · ${e.author}`}</div>
                          <div className="tl-title">{e.title}</div>
                          <div className="tl-text">{e.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* DOCUMENTS */}
                {matterTab==="Documents" && (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,alignItems:"center"}}>
                      <div className="card-title">
                        Documents {documentsLoading ? "· Loading…" : documents.length ? `· ${documents.length}` : ""}
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <button
                          className="btn-ghost"
                          style={{fontSize:12}}
                          type="button"
                          onClick={handleDocumentUploadClick}
                          disabled={uploadingDocument}
                        >
                          {uploadingDocument ? "Uploading…" : "📎 Upload Document"}
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          style={{display:"none"}}
                          onChange={handleDocumentFileChange}
                        />
                      </div>
                    </div>
                    {documentsLoading ? (
                      <div style={{fontSize:12,color:"var(--text-3)",padding:"12px 0"}}>Loading documents…</div>
                    ) : documents.length === 0 ? (
                      <div style={{fontSize:12,color:"var(--text-3)",padding:"12px 0"}}>
                        No documents yet — upload your first document
                      </div>
                    ) : (
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {documents.map((d,i)=>(
                          <div key={d.name || i} className="doc-item">
                            <div className="doc-icon" style={{background:"#eff6ff"}}>
                              📄
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div className="doc-name">{d.name}</div>
                              <div className="doc-meta">
                                {d.created_at ? new Date(d.created_at).toLocaleDateString() : "Uploaded"}
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:4}}>
                              <button
                                style={{fontSize:11,color:"var(--text-3)",background:"none",border:"none",cursor:"pointer"}}
                                type="button"
                                onClick={()=>handleViewDocument(d)}
                              >
                                View
                              </button>
                              <button
                                style={{fontSize:11,color:"var(--red)",background:"none",border:"none",cursor:"pointer"}}
                                type="button"
                                onClick={()=>handleDeleteDocument(d.name)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* SEARCHES */}
                {matterTab==="Searches" && (() => {
                  const isPurchase = (selMatterObj.type || "").toLowerCase().includes("purchase");
                  const isSale = (selMatterObj.type || "").toLowerCase().includes("sale");
                  const state = (selMatterObj.state || "NSW").toUpperCase();
                  const key = isSale ? "Sale" : state === "VIC" && isPurchase ? "VIC_Purchase" : "NSW_Purchase";
                  const searchTypes = SEARCH_TYPES_BY_MATTER[key] || SEARCH_TYPES_BY_MATTER.NSW_Purchase;
                  const matterId = selMatterObj.id;
                  let statusMap = matterSearches[matterId];
                  if (!statusMap && selMatterObj.notes) {
                    try {
                      const parsed = JSON.parse(selMatterObj.notes);
                      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) statusMap = parsed;
                    } catch (_) {}
                  }
                  if (!statusMap) statusMap = {};
                  const setSearchStatus = (searchId, status) => {
                    const next = { ...(matterSearches[matterId] || {}), [searchId]: status };
                    setMatterSearches(prev => ({ ...prev, [matterId]: next }));
                    const notesPayload = JSON.stringify(next);
                    supabase.from("matters").update({ notes: notesPayload }).eq("matter_ref", matterId).then(() => {});
                  };
                  const openInfoTrack = (searchId) => {
                    window.open("https://www.infotrack.com.au", "_blank");
                    setSearchStatus(searchId, "ordered");
                    setTimeout(() => alert("API integration coming soon"), 300);
                  };
                  return (
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                        {searchTypes.map(s => (
                          <div key={s.id} className="card" style={{padding:14}}>
                            <div className="card-title" style={{marginBottom:6}}>{s.name}</div>
                            <div style={{fontSize:11,color:"var(--text-3)",marginBottom:8}}>{s.desc}</div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                              <span className="tag tag-gray" style={{fontSize:10}}>{s.provider}</span>
                              <span className="tag tag-gray" style={{fontSize:10}}>⏱ {s.turnaround}</span>
                            </div>
                            <div style={{marginBottom:10}}>
                              <span className={`tag ${(statusMap[s.id] || "not_ordered") === "received" ? "tag-green" : (statusMap[s.id] || "not_ordered") === "ordered" ? "tag-amber" : "tag-gray"}`} style={{fontSize:10}}>
                                {(statusMap[s.id] || "not_ordered") === "not_ordered" ? "Not Ordered" : statusMap[s.id] === "ordered" ? "Ordered" : "Received"}
                              </span>
                            </div>
                            <button type="button" className="btn-primary" style={{fontSize:11,width:"100%"}} onClick={() => openInfoTrack(s.id)}>
                              Order via InfoTrack
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* TASKS */}
                {matterTab==="Tasks" && (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                      <div className="card-title">Tasks — {selMatterObj.client}</div>
                      <button className="btn-gold" style={{fontSize:12}}>＋ Add Task</button>
                    </div>
                    {tasks.filter(t=>t.matter===selMatterObj.id).map(t=>(
                      <div key={t.id} style={{display:"flex",gap:12,padding:"11px 16px",background:"var(--white)",borderRadius:10,border:"1px solid var(--border)",marginBottom:8,alignItems:"flex-start",boxShadow:"var(--shadow-sm)"}}>
                        <div className={`task-check ${t.done?"done":""}`}
                          onClick={()=>setTasks(prev=>prev.map(x=>x.id===t.id?{...x,done:!x.done}:x))}>
                          {t.done&&"✓"}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:600,color:t.done?"var(--text-3)":"var(--text)",textDecoration:t.done?"line-through":"none",marginBottom:3}}>{t.task}</div>
                          <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>Due: {t.due}</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:URGENCY_COLOR[t.urgency]}}/>
                          <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{t.urgency}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* COMMUNICATIONS - modal opens on tab click, no inline content */}
                {matterTab==="Communications" && null}

                {/* BILLING */}
                {matterTab==="Billing" && (
                  <div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
                      {[{label:"Total Fee",value:"$2,800",sub:"inc. GST"},{label:"Invoiced",value:"$2,800",sub:"1 invoice"},{label:"Paid",value:"$0",sub:"outstanding"}].map(s=>(
                        <div key={s.label} className="acc-stat">
                          <div className="acc-stat-label">{s.label}</div>
                          <div style={{fontFamily:"var(--font-display)",fontSize:22,fontWeight:500,color:"var(--text)",marginBottom:2}}>{s.value}</div>
                          <div style={{fontSize:11,color:"var(--text-3)"}}>{s.sub}</div>
                        </div>
                      ))}
                    </div>
                    {(invoices || []).filter(inv=>inv.matter===selMatterObj.id).map(inv=>(
                      <div key={inv.id} className="billing-row">
                        <div>
                          <div className="billing-id">{inv.id}</div>
                          <div style={{fontSize:11,color:"var(--text-2)",marginTop:2}}>Due {inv.due}</div>
                        </div>
                        <div className="billing-amount">${inv.amount.toLocaleString()}</div>
                        <span className={`tag ${inv.status==="paid"?"tag-green":"tag-amber"}`}>{inv.status}</span>
                        <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}}>View Invoice</button>
                      </div>
                    ))}
                    {(invoices || []).filter(inv=>inv.matter===selMatterObj.id).length===0&&(
                      <div className="billing-row">
                        <div style={{fontSize:12,color:"var(--text-3)"}}>No invoices yet for this matter.</div>
                        <button className="btn-gold" style={{fontSize:12}}>＋ Create Invoice</button>
                      </div>
                    )}
                  </div>
                )}

                {/* AI ASSISTANT */}
                {matterTab==="AI Assistant" && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16,height:"calc(100vh - 280px)"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4}}>
                        {["Summarise this matter","Identify contract risks","Draft client update email","Generate search checklist"].map(q=>(
                          <button key={q} className="filter-btn" onClick={()=>sendAI(q)}>✦ {q}</button>
                        ))}
                      </div>
                      <div style={{flex:1,background:"var(--ink)",borderRadius:14,padding:16,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,border:"1px solid var(--ink-2)"}}>
                        {aiMessages.map(m=>(
                          <div key={m.id} className={`ai-msg ${m.role}`}>
                            <div className={`ai-msg-avatar ${m.role==="ai"?"ai-av":"user-av"}`}>{m.role==="ai"?"✦":"JC"}</div>
                            <div className={`ai-bubble ${m.role==="ai"?"ai-b":"user-b"}`}>
                              <div>{m.text}</div>
                              {m.bullets&&<ul className="ai-bullets">{m.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>}
                            </div>
                          </div>
                        ))}
                        {isTyping&&<div className="ai-msg"><div className="ai-msg-avatar ai-av">✦</div><div className="ai-bubble ai-b"><div className="ai-typing"><div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/></div></div></div>}
                        <div ref={aiEndRef}/>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <input className="ai-input" style={{flex:1,borderRadius:8,padding:"9px 14px",fontSize:12,background:"var(--white)",border:"1px solid var(--border)",color:"var(--text)"}}
                          placeholder="Ask about this matter..." value={aiInput}
                          onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendAI()}/>
                        <button className="btn-gold" onClick={()=>sendAI()}>Send ›</button>
                      </div>
                    </div>
                    <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
                      {[
                        {title:"Matter Context",items:["Type: "+selMatterObj.type+" · "+selMatterObj.state,"Value: "+selMatterObj.price,"Stage: "+selMatterObj.stage,"Settlement: "+fmt(selMatterObj.settlement)]},
                        {title:"AI Risk Flags",items:["⚠ Pool cert outstanding — HIGH","⚠ PEXA workspace not created","ℹ Searches pending — MEDIUM"]},
                      ].map(s=>(
                        <div key={s.title} className="card">
                          <div className="card-hdr"><div className="card-title">{s.title}</div></div>
                          <div style={{padding:"6px 16px 12px"}}>
                            {s.items.map((item,i)=>(
                              <div key={i} style={{fontSize:11,color:"var(--text-2)",padding:"4px 0",borderBottom:"1px solid var(--border-2)"}}>{item}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              REFERRALS
          ══════════════════════════════════════════════ */}
          {page === "referrals" && (
            <div className="content" style={{padding:"20px 24px",height:"calc(100vh - 58px)",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",marginBottom:16,gap:10}}>
                <div style={{flex:1}}>
                  <div className="stat-row" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:0}}>
                    {[
                      {label:"Total Referrers",value:(referrers||[]).length,sub:"partners",cls:""},
                      {label:"Total Referrals",value:(referrers||[]).reduce((s,r)=>s+(r.referrals||0),0),sub:"all time",cls:"stat-accent"},
                      {label:"Fees Paid",value:"$1,500",sub:"YTD",cls:"stat-gold"},
                      {label:"Fees Owed",value:"$300",sub:"outstanding",cls:"stat-red"},
                    ].map(s=>(
                      <div key={s.label} className={`stat ${s.cls}`}>
                        <div className="stat-label">{s.label}</div>
                        <div className="stat-value">{s.value}</div>
                        <div className="stat-sub">{s.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ref-layout">
                <div className="ref-list">
                  {(referrers||[]).map(r=>(
                    <div key={r.id} className={`ref-list-item ${selectedRef===r.id?"active":""}`}
                      onClick={()=>setSelectedRef(r.id)}>
                      <div className="rli-name">{r.name}</div>
                      <div className="rli-type">{r.type} · Partner since {r.since}</div>
                      <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                        <span className="fee-pill fee-none">{r.referrals} referrals</span>
                        {r.feeOwed>0 ? <span className="fee-pill fee-owed">⚠ ${r.feeOwed} owed</span> : r.totalFees>0 ? <span className="fee-pill fee-paid">✓ ${r.totalFees} paid</span> : <span style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>No fee</span>}
                        {r.formalAgreement && <span className="tag tag-gold">✓ Agreement</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="ref-detail">
                  {!selRef ? (
                    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-3)",flexDirection:"column",gap:8,height:"100%",padding:40}}>
                      <div style={{fontFamily:"var(--font-display)",fontSize:32,opacity:0.15}}>🤝</div>
                      <div style={{fontFamily:"var(--font-display)",fontSize:16,color:"var(--text)"}}>Select a referral partner</div>
                      <div style={{fontSize:12}}>Choose from the list to view their details.</div>
                    </div>
                  ) : (
                    <>
                      <div className="rdt-header">
                        <div className="rdt-name">{selRef.name}</div>
                        <div className="rdt-meta">{selRef.company} · {selRef.type} · {selRef.phone} · {selRef.email}</div>
                        <div style={{display:"flex",gap:8,marginBottom:4}}>
                          <span className={`tag ${selRef.formalAgreement?"tag-green":"tag-amber"}`}>{selRef.formalAgreement?"✓ Formal Agreement":"No Agreement"}</span>
                          <span className="tag tag-gray">Partner since {selRef.since}</span>
                        </div>
                        <div className="rdt-summary">
                          {[
                            {label:"Total Referrals",value:selRef.referrals},
                            {label:"Total Fees Paid",value:"$"+selRef.totalFees.toLocaleString()},
                            {label:"Fees Owed",value:selRef.feeOwed>0?"$"+selRef.feeOwed:"—"},
                            {label:"Avg Value",value:selRef.referrals>0?"$"+(Math.round(selRef.totalFees/selRef.referrals||0)).toLocaleString():"—"},
                          ].map(s=>(
                            <div key={s.label} className="rdt-sum-card">
                              <div className="rdt-sum-label">{s.label}</div>
                              <div className="rdt-sum-value">{s.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{padding:"14px 22px",background:"var(--amber-light)",borderTop:"1px solid #fde68a",fontSize:12,color:"#78350f",display:"flex",gap:8}}>
                        <span>💡</span><span>{selRef.notes}</span>
                      </div>
                      <div style={{padding:"14px 22px"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginBottom:12}}>Referred Matters</div>
                        <div style={{background:"var(--white)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",overflow:"hidden"}}>
                          <div style={{display:"grid",gridTemplateColumns:"110px 1fr 110px 90px",padding:"8px 16px",background:"var(--surface)",borderBottom:"1px solid var(--border)",gap:12}}>
                            {["Matter","Client","Value","Fee"].map(h=><div key={h} style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1px"}}>{h}</div>)}
                          </div>
                          {MATTERS.filter(m=>[selRef.id].includes("REF-001")&&m.source==="Referral"||m.agent===selRef.company).slice(0,5).map((m,i)=>(
                            <div key={i} style={{display:"grid",gridTemplateColumns:"110px 1fr 110px 90px",padding:"10px 16px",borderBottom:"1px solid var(--border-2)",gap:12,alignItems:"center",cursor:"pointer"}}
                              onClick={()=>{setSelectedMatter(m.id);setPage("matter_workspace");setMatterTab("Overview");}}>
                              <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{m.id}</div>
                              <div style={{fontSize:12,fontWeight:600,color:"var(--text)"}}>{m.client}</div>
                              <div style={{fontSize:12,fontFamily:"var(--font-mono)",color:"var(--text)"}}>{m.price}</div>
                              <span className="fee-pill fee-none">$300</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              CONTACTS
          ══════════════════════════════════════════════ */}
          {page === "contacts" && (
            <div className="content" style={{padding:0,height:"calc(100vh - 58px)",overflow:"hidden",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:12,flexShrink:0,padding:"20px 24px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontFamily:"var(--font-display)",fontSize:20,fontWeight:600,color:"var(--text)"}}>Contacts</span>
                  {contacts.length > 0 && <span className="tag tag-gold" style={{fontSize:10}}>{contacts.length}</span>}
                  <div className="tb-search" style={{width:240}}>
                    <input type="text" placeholder="Search name, email, phone…" value={contactSearch} onChange={(e)=>setContactSearch(e.target.value)} style={{flex:1}}/>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {["all","Clients","Real Estate Agents","Brokers","Accountants","Referrers"].map((f)=>(
                      <button key={f} type="button" className={`filter-btn ${contactFilter===f?"active":""}`} style={{fontSize:10,padding:"4px 10px"}} onClick={()=>setContactFilter(f)}>{f==="all"?"All":f}</button>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button type="button" className="btn-ghost" style={{fontSize:12}} onClick={()=>{ const headers = ["Name","Type","Email","Phone","Address","Company","Is Referrer","Referrer Fee","Formal Agreement","Notes"]; const rows = contacts.map((c)=>[c.name,c.type,c.email,c.phone,c.address,c.company,c.is_referrer?"Yes":"No",c.referrer_fee??"",c.formal_agreement?"Yes":"No",(c.notes||"").replace(/"/g,'""')]); const csv = [headers.join(","), ...rows.map((r)=>r.map((v)=>`"${String(v??"")}"`).join(","))].join("\n"); const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "contacts.csv"; a.click(); URL.revokeObjectURL(url); }}>Export CSV</button>
                  <button type="button" className="btn-gold" style={{fontSize:12}} onClick={()=>{ setContactForm({ name: "", type: "Client", email: "", phone: "", address: "", company: "", is_referrer: false, referrer_fee: "", formal_agreement: false, notes: "" }); setEditingContact(null); setContactModal(true); }}>+ Add Contact</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20,flexShrink:0,padding:"0 24px"}}>
                <div className="stat"><div className="stat-label">Total Contacts</div><div className="stat-value">{contacts.length}</div></div>
                <div className="stat"><div className="stat-label">Clients</div><div className="stat-value">{contacts.filter(c=>c.type==="Client").length}</div></div>
                <div className="stat"><div className="stat-label">Agents / Brokers</div><div className="stat-value">{contacts.filter(c=>c.type==="Real Estate Agent"||c.type==="Broker").length}</div></div>
                <div className="stat"><div className="stat-label">Referrers</div><div className="stat-value">{contacts.filter(c=>c.is_referrer).length}</div></div>
              </div>
              <div style={{flex:1,overflowY:"auto",minHeight:0,padding:"0 24px 24px"}}>
              {contactsLoading ? (
                <div style={{padding:40,textAlign:"center",color:"var(--text-3)",fontSize:13}}>Loading contacts...</div>
              ) : (
                <div className="matter-table contacts-table">
                  <div className="mt-thead">
                    <div className="mt-th">Name</div><div className="mt-th">Type</div><div className="mt-th">Phone</div><div className="mt-th">Email</div><div className="mt-th">Matters</div><div className="mt-th">Referrer</div>
                  </div>
                  {(()=>{
                    const filteredContacts = contacts.filter((c) => {
                      const matchesSearch = !contactSearch.trim() ||
                        (c.name && c.name.toLowerCase().includes(contactSearch.toLowerCase())) ||
                        (c.email && c.email.toLowerCase().includes(contactSearch.toLowerCase())) ||
                        (c.phone && String(c.phone).includes(contactSearch));
                      const matchesFilter = contactFilter === "all" ||
                        (contactFilter === "Clients" && c.type === "Client") ||
                        (contactFilter === "Real Estate Agents" && c.type === "Real Estate Agent") ||
                        (contactFilter === "Brokers" && c.type === "Broker") ||
                        (contactFilter === "Accountants" && c.type === "Accountant") ||
                        (contactFilter === "Referrers" && c.is_referrer);
                      return matchesSearch && matchesFilter;
                    });
                    console.log("Contacts after filter:", filteredContacts.length, "contactFilter:", contactFilter, "contactSearch:", contactSearch);
                    return filteredContacts.map((c)=>{
                      const initials = (c.name||"?").split(" ").map((w)=>w[0]).join("").slice(0,2).toUpperCase();
                      const hue = (c.id||c.name||"").length % AVATAR_COLORS.length;
                      const typeTag = { Client: "tag-teal", "Real Estate Agent": "tag-blue", Broker: "tag-amber", Accountant: "tag-purple", Other: "tag-gray" }[c.type] || "tag-gray";
                      const matterCount = MATTERS.filter((m)=>m.client&&c.name&&(String(m.client).toLowerCase().includes(String(c.name).toLowerCase())||String(c.name).toLowerCase().includes(String(m.client).toLowerCase()))).length;
                      return (
                        <div key={c.id} className="mt-row" style={{cursor:"pointer"}} onClick={()=>setViewingContact(c)}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:36,height:36,borderRadius:"50%",background:AVATAR_COLORS[hue],display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0}}>{initials}</div>
                            <div><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{c.name}</div><div style={{fontSize:11,color:"var(--text-3)"}}>{c.company||"—"}</div></div>
                          </div>
                          <div><span className={`tag ${typeTag}`} style={{fontSize:10}}>{c.type||"Other"}</span></div>
                          <div style={{fontSize:12,fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{c.phone||"—"}</div>
                          <div style={{fontSize:12,color:"var(--text-3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email||"—"}</div>
                          <div onClick={e=>e.stopPropagation()}>{matterCount>0 ? <span className="tag tag-gray" style={{fontSize:10,cursor:"pointer"}} onClick={()=>setViewingContact(c)}>{matterCount}</span> : <span style={{fontSize:11,color:"var(--text-3)"}}>0</span>}</div>
                          <div style={{fontSize:14}}>{c.is_referrer?"★":""}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              CALENDAR
          ══════════════════════════════════════════════ */}
          {page === "calendar" && (
            <div className="content" style={{height:"calc(100vh - 58px)",overflowY:"auto",padding:"20px 24px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:16,flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <h1 style={{fontFamily:"var(--font-display)",fontSize:24,fontWeight:600,color:"var(--text)",margin:0}}>
                    Calendar {calendarView==="month" ? calendarDate.toLocaleDateString("en-AU",{month:"long",year:"numeric"}) : "Week of "+calendarDate.toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short"})}
                  </h1>
                  <button type="button" className="btn-ghost" style={{width:36,height:36,padding:0,fontSize:16}} onClick={()=>{ const d=new Date(calendarDate); d.setMonth(d.getMonth()-1); if(calendarView==="week") d.setDate(d.getDate()-7); setCalendarDate(d); }}>‹</button>
                  <button type="button" className="btn-ghost" style={{width:36,height:36,padding:0,fontSize:16}} onClick={()=>{ const d=new Date(calendarDate); d.setMonth(d.getMonth()+1); if(calendarView==="week") d.setDate(d.getDate()+7); setCalendarDate(d); }}>›</button>
                  <button type="button" className="btn-ghost" style={{fontSize:12}} onClick={()=>setCalendarDate(new Date())}>Today</button>
                  <div style={{display:"flex",gap:0}}>
                    <button type="button" className={`filter-btn ${calendarView==="month"?"active":""}`} style={{fontSize:11,padding:"5px 12px",borderRadius:"6px 0 0 6px"}} onClick={()=>setCalendarView("month")}>Month</button>
                    <button type="button" className={`filter-btn ${calendarView==="week"?"active":""}`} style={{fontSize:11,padding:"5px 12px",borderRadius:"0 6px 6px 0"}} onClick={()=>setCalendarView("week")}>Week</button>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button type="button" className="btn-ghost" style={{fontSize:12,borderColor:"var(--blue)",color:"var(--blue)"}} onClick={scanEmailsForEvents} disabled={aiCalendarLoading}>{aiCalendarLoading?"Scanning…":"✦ Scan Emails for Events"}</button>
                  <button type="button" className="btn-gold" style={{fontSize:12}} onClick={()=>{ setNewEvent({title:"",event_type:"meeting",matter_ref:"",client_name:"",date:"",time:"",notes:""}); setAddEventModal(true); }}>＋ Add Event</button>
                </div>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12,fontSize:10}}>
                {Object.entries(EVENT_COLORS).map(([key,val])=>(<span key={key} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:4,background:val.bg,color:val.text,borderLeft:"2px solid "+val.border}}>{key}</span>))}
              </div>
              {calendarLoading ? (
                <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-3)",fontSize:14}}>Loading calendar…</div>
              ) : calendarView==="month" ? (
                (()=>{
                  const generateMonthGrid = () => {
                    const year = calendarDate.getFullYear();
                    const month = calendarDate.getMonth();
                    const firstDay = new Date(year, month, 1);
                    const lastDay = new Date(year, month + 1, 0);
                    let startDate = new Date(firstDay);
                    const dayOfWeek = firstDay.getDay();
                    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                    startDate.setDate(startDate.getDate() - daysToSubtract);
                    const days = [];
                    for (let i = 0; i < 42; i++) {
                      const date = new Date(startDate);
                      date.setDate(startDate.getDate() + i);
                      days.push(date);
                    }
                    return days;
                  };
                  const toYMD=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  const todayYMD=toYMD(new Date());
                  const cells = generateMonthGrid();
                  const dayHeaders=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
                  return (
                    <div className="calendar-grid">
                      {dayHeaders.map(h=>(<div key={h} className="calendar-day-header">{h}</div>))}
                      {cells.map((d,i)=>{
                        const ymd=toYMD(d);
                        const isOtherMonth=d.getMonth()!==calendarDate.getMonth();
                        const isToday=ymd===todayYMD;
                        const dayEvents=(calendarEvents||[]).filter((e)=>{
                          const eventDate = new Date((e.date||"").slice(0,10)+"T00:00:00");
                          return eventDate.getFullYear()===d.getFullYear() && eventDate.getMonth()===d.getMonth() && eventDate.getDate()===d.getDate();
                        });
                        return (
                          <div key={i} className={`calendar-day ${isOtherMonth?"other-month":""} ${isToday?"today":""}`} onClick={(ev)=>{ if(ev.target.closest(".cal-event-pill")) return; setNewEvent(prev=>({...prev,date:ymd})); setAddEventModal(true); }}>
                            <div className="cal-day-num">{d.getDate()}</div>
                            {dayEvents.slice(0,3).map(ev=>{
                              const c=EVENT_COLORS[ev.event_type]||EVENT_COLORS.auto;
                              return (<div key={ev.id} className="cal-event-pill" style={{background:c.bg,color:c.text,borderColor:c.border}} onClick={e=>{ e.stopPropagation(); setSelectedEvent(ev); setEventModal(true); }} title={ev.title} onMouseEnter={(e)=>{ const rect=e.currentTarget.getBoundingClientRect(); setTooltip({event:ev,x:rect.left,y:rect.top}); }} onMouseLeave={()=>setTooltip(null)} onMouseMove={(e)=>{ setTooltip(prev=>prev?{...prev,x:e.clientX,y:e.clientY}:null); }}>{ev.title?.slice(0,20)}{(ev.title||"").length>20?"…":""}</div>);
                            })}
                            {dayEvents.length>3&&<div style={{fontSize:9,color:"var(--text-3)",marginTop:2}}>+{dayEvents.length-3} more</div>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              ) : (
                (()=>{
                  const toYMD=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  const todayYMD=toYMD(new Date());
                  const weekStart=new Date(calendarDate); const dayNum=weekStart.getDay(); const diff=(dayNum+6)%7; weekStart.setDate(weekStart.getDate()-diff);
                  const weekDays=[]; for(let i=0;i<7;i++){ const d=new Date(weekStart); d.setDate(d.getDate()+i); weekDays.push(d); }
                  const hours=[]; for(let h=7;h<=19;h++) hours.push(h);
                  return (
                    <div className="week-grid" style={{flex:1,minHeight:0}}>
                      <div className="week-time-col" style={{borderBottom:"1px solid var(--border)"}}/>
                      {weekDays.map(d=>(
                        <div key={d.getTime()} className={`week-day-header ${toYMD(d)===todayYMD?"today":""}`}>
                          {d.toLocaleDateString("en-AU",{weekday:"short"})} {d.getDate()}
                        </div>
                      ))}
                      {hours.map(h=>(
                        <div key={h} style={{display:"contents"}}>
                          <div className="week-time-col" style={{padding:"4px 6px",fontSize:10,color:"var(--text-3)",borderBottom:"1px solid var(--border-2)"}}>{h}:00</div>
                          {weekDays.map(d=>{
                            const ymd=toYMD(d);
                            const dayEvents=(calendarEvents||[]).filter((e)=>{
                              const eventDate = new Date((e.date||"").slice(0,10)+"T00:00:00");
                              return eventDate.getFullYear()===d.getFullYear() && eventDate.getMonth()===d.getMonth() && eventDate.getDate()===d.getDate();
                            });
                            const slotEvents=dayEvents.filter(e=>e.time&&e.time.includes(":")).map(e=>{ const [hh,mm]=e.time.split(":").map(Number); return { ...e, hour: hh + (mm||0)/60 }; }).filter(e=>e.hour>=7&&e.hour<20);
                            const fullDayEvents=dayEvents.filter(e=>!e.time||!e.time.includes(":"));
                            return (
                              <div key={d.getTime()} className="week-day-col" style={{borderBottom:"1px solid var(--border-2)"}}>
                                {fullDayEvents.map(ev=>{ const c=EVENT_COLORS[ev.event_type]||EVENT_COLORS.auto; return <div key={ev.id} className="cal-event-pill" style={{background:c.bg,color:c.text,borderColor:c.border,margin:2}} onClick={()=>{ setSelectedEvent(ev); setEventModal(true); }} onMouseEnter={(e)=>{ const rect=e.currentTarget.getBoundingClientRect(); setTooltip({event:ev,x:rect.left,y:rect.top}); }} onMouseLeave={()=>setTooltip(null)} onMouseMove={(e)=>{ setTooltip(prev=>prev?{...prev,x:e.clientX,y:e.clientY}:null); }}>{ev.title}</div>; })}
                                {slotEvents.map(ev=>{ const c=EVENT_COLORS[ev.event_type]||EVENT_COLORS.auto; const top=((ev.hour-7)/12)*100; return <div key={ev.id} className="cal-event-pill" style={{position:"absolute",left:4,right:4,top:top+"%",background:c.bg,color:c.text,borderColor:c.border}} onClick={()=>{ setSelectedEvent(ev); setEventModal(true); }} onMouseEnter={(e)=>{ const rect=e.currentTarget.getBoundingClientRect(); setTooltip({event:ev,x:rect.left,y:rect.top}); }} onMouseLeave={()=>setTooltip(null)} onMouseMove={(e)=>{ setTooltip(prev=>prev?{...prev,x:e.clientX,y:e.clientY}:null); }}>{ev.title} {ev.time}</div>; })}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {/* Event detail modal */}
          {eventModal && selectedEvent && (
            <div className="contact-modal-overlay" onClick={()=>{ setEventModal(false); setSelectedEvent(null); }}>
              <div className="contact-modal" style={{width:"90%",maxWidth:420}} onClick={e=>e.stopPropagation()}>
                <div className="contact-modal-hdr">
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"var(--font-display)",fontSize:18,fontWeight:600,color:"var(--text)"}}>{selectedEvent.title}</div>
                    <div style={{fontSize:12,color:"var(--text-3)",marginTop:4}}>
                      {(EVENT_COLORS[selectedEvent.event_type]||EVENT_COLORS.auto) && <span style={{display:"inline-block",padding:"2px 8px",borderRadius:4,background:(EVENT_COLORS[selectedEvent.event_type]||EVENT_COLORS.auto).bg,color:(EVENT_COLORS[selectedEvent.event_type]||EVENT_COLORS.auto).text,marginRight:8}}>{selectedEvent.event_type}</span>}
                      {selectedEvent.date} {selectedEvent.time||""}
                    </div>
                  </div>
                  <button type="button" className="modal-close" onClick={()=>{ setEventModal(false); setSelectedEvent(null); }}>✕</button>
                </div>
                <div style={{padding:20}}>
                  {selectedEvent.matter_ref&&<div style={{marginBottom:8}}><span style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase"}}>Matter</span><br/><button type="button" className="btn-ghost" style={{fontSize:12,padding:0}} onClick={()=>{ setSelectedMatter(selectedEvent.matter_ref); setPage("matter_workspace"); setMatterTab("Overview"); setEventModal(false); setSelectedEvent(null); }}>{selectedEvent.matter_ref}</button></div>}
                  {selectedEvent.client_name&&<div style={{marginBottom:8}}><span style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase"}}>Client</span><br/><span style={{fontSize:13}}>{selectedEvent.client_name}</span></div>}
                  {selectedEvent.notes&&<div style={{marginBottom:12}}><span style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase"}}>Notes</span><br/><span style={{fontSize:12,color:"var(--text-2)",whiteSpace:"pre-wrap"}}>{selectedEvent.notes}</span></div>}
                  <div style={{display:"flex",gap:8,marginTop:16}}>
                    <button type="button" className="btn-ghost" style={{fontSize:12}}>Edit</button>
                    <button type="button" className="btn-ghost" style={{fontSize:12,color:"var(--red)"}} onClick={async ()=>{ if(!confirm("Delete this event?")) return; await supabase.from("calendar_events").delete().eq("id",selectedEvent.id); setCalendarEvents(prev=>prev.filter(e=>e.id!==selectedEvent.id)); setEventModal(false); setSelectedEvent(null); }}>Delete</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Add/Edit event modal */}
          {addEventModal && (
            <div className="contact-modal-overlay" onClick={()=>setAddEventModal(false)}>
              <div className="contact-modal" style={{width:"90%",maxWidth:440}} onClick={e=>e.stopPropagation()}>
                <div className="contact-modal-hdr">
                  <div style={{fontFamily:"var(--font-display)",fontSize:18,fontWeight:600}}>Add Event</div>
                  <button type="button" className="modal-close" onClick={()=>setAddEventModal(false)}>✕</button>
                </div>
                <div style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
                  <div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Title</label><input style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13}} value={newEvent.title} onChange={e=>setNewEvent(prev=>({...prev,title:e.target.value}))} placeholder="Event title"/></div>
                  <div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Type</label><select style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13}} value={newEvent.event_type} onChange={e=>setNewEvent(prev=>({...prev,event_type:e.target.value}))}><option value="settlement">Settlement</option><option value="finance">Finance Due</option><option value="meeting">Meeting</option><option value="task">Task</option><option value="search">Search Expiry</option><option value="deadline">Contract Deadline</option><option value="contract">Contract</option><option value="auto">Other</option></select></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Date</label><input type="date" style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13}} value={newEvent.date} onChange={e=>setNewEvent(prev=>({...prev,date:e.target.value}))}/></div><div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Time</label><input type="time" style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13}} value={newEvent.time} onChange={e=>setNewEvent(prev=>({...prev,time:e.target.value}))}/></div></div>
                  <div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Matter</label><select style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13}} value={newEvent.matter_ref} onChange={e=>{ const m=MATTERS.find(x=>x.id===e.target.value); setNewEvent(prev=>({...prev,matter_ref:e.target.value,client_name:m?.client||""}));}}><option value="">—</option>{MATTERS.map(m=>(<option key={m.id} value={m.id}>{m.id} · {m.client}</option>))}</select></div>
                  <div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Client</label><input style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13}} value={newEvent.client_name} onChange={e=>setNewEvent(prev=>({...prev,client_name:e.target.value}))} placeholder="Client name"/></div>
                  <div><label style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",display:"block",marginBottom:4}}>Notes</label><textarea style={{width:"100%",padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,minHeight:60}} value={newEvent.notes} onChange={e=>setNewEvent(prev=>({...prev,notes:e.target.value}))} placeholder="Notes"/></div>
                  <button type="button" className="btn-gold" style={{fontSize:13}} onClick={async ()=>{ if(!newEvent.title||!newEvent.date) return; await supabase.from("calendar_events").insert({...newEvent}); const {data}=await supabase.from("calendar_events").select("*").order("date"); setCalendarEvents(data||[]); setAddEventModal(false); setNewEvent({title:"",event_type:"meeting",matter_ref:"",client_name:"",date:"",time:"",notes:""}); }}>Save</button>
                </div>
              </div>
            </div>
          )}

          {/* Contact detail modal */}
          {viewingContact && (
            <div className="contact-modal-overlay" onClick={()=>setViewingContact(null)}>
              <div ref={modalRef} className="contact-modal" onClick={e=>e.stopPropagation()} style={{...modalSize,position:"relative"}}>
                <div className="contact-modal-hdr">
                  <div style={{width:56,height:56,borderRadius:"50%",background:AVATAR_COLORS[(viewingContact.id||viewingContact.name||"").length%AVATAR_COLORS.length],display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:"#fff",flexShrink:0}}>{(viewingContact.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"var(--font-display)",fontSize:22,fontWeight:500,color:"var(--text)",marginBottom:4}}>{viewingContact.name}</div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span className={`tag ${{Client:"tag-teal","Real Estate Agent":"tag-blue",Broker:"tag-amber",Accountant:"tag-purple",Other:"tag-gray"}[viewingContact.type]||"tag-gray"}`} style={{fontSize:10}}>{viewingContact.type||"Other"}</span>
                      {viewingContact.is_referrer && <span className="tag tag-gold" style={{fontSize:10}}>Referrer</span>}
                    </div>
                  </div>
                  <button type="button" className="btn-ghost" style={{fontSize:12}} onClick={()=>{ setContactForm({ name: viewingContact.name||"", type: viewingContact.type||"Client", email: viewingContact.email||"", phone: viewingContact.phone||"", address: viewingContact.address||"", company: viewingContact.company||"", is_referrer: !!viewingContact.is_referrer, referrer_fee: viewingContact.referrer_fee!=null?String(viewingContact.referrer_fee):"", formal_agreement: !!viewingContact.formal_agreement, notes: viewingContact.notes||"" }); setEditingContact(viewingContact); setViewingContact(null); setContactModal(true); }}>Edit</button>
                  <button type="button" className="btn-ghost" style={{fontSize:12,color:"var(--red)"}} onClick={async ()=>{ if(!confirm("Delete this contact?")) return; await supabase.from("contacts").delete().eq("id",viewingContact.id); setContacts(prev=>prev.filter(x=>x.id!==viewingContact.id)); setViewingContact(null); }}>Delete</button>
                  <button type="button" className="modal-close" onClick={()=>setViewingContact(null)}>✕</button>
                </div>
                <div className="contact-modal-body" style={{display:"flex",flex:1,overflow:"hidden",minHeight:0,height:"100%"}}>
                  <div className="contact-modal-left" style={{width:contactPanelWidths[0],flexShrink:0}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>Emails</span>
                      {contactEmails.filter(e=>!e.isRead).length>0 && <span className="tag tag-gold" style={{fontSize:9}}>{contactEmails.filter(e=>!e.isRead).length}</span>}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <button type="button" style={{width:28,height:28,border:"1px solid var(--border)",borderRadius:6,background:"var(--surface)",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setEmailSortAsc(!emailSortAsc)} title={emailSortAsc?"Newest first":"Oldest first"}>{emailSortAsc?"↑":"↓"}</button>
                        <button type="button" className="icon-btn" style={{width:28,height:28}} onClick={fetchContactEmails} disabled={contactEmailsLoading} title="Refresh">↻</button>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6,padding:"8px 12px",borderBottom:"1px solid var(--border-2)"}}>
                      {["inbox","sent","all"].map(t=>(
                        <button key={t} type="button" className={`filter-btn ${contactDetailInboxTab===t?"active":""}`} style={{fontSize:10,padding:"3px 8px"}} onClick={()=>setContactDetailInboxTab(t)}>{t==="inbox"?"Inbox":t==="sent"?"Sent":"All"}</button>
                      ))}
                    </div>
                    <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border-2)"}}>
                      <div className="tb-search" style={{width:"100%"}}><input type="text" placeholder="Search emails…" value={contactDetailSearch} onChange={e=>setContactDetailSearch(e.target.value)} style={{flex:1}}/></div>
                    </div>
                    <div style={{flex:1,overflowY:"auto"}}>
                      {(()=>{
                        const filteredContactEmails = (contactDetailInboxTab==="inbox"?contactEmails.filter(e=>!e.isOutgoing):contactDetailInboxTab==="sent"?contactEmails.filter(e=>e.isOutgoing):contactEmails)
                          .filter(e=>!contactDetailSearch.trim()||[e.subject,e.bodyPreview,e.from?.name,e.from?.address].some(s=>String(s||"").toLowerCase().includes(contactDetailSearch.toLowerCase())));
                        const sortedContactEmails = [...filteredContactEmails].sort((a,b)=>{ const diff = new Date(a.receivedDateTime) - new Date(b.receivedDateTime); return emailSortAsc ? diff : -diff; });
                        return sortedContactEmails.map((e)=>{
                          const name = e.from?.name||e.from?.address||"Unknown";
                          const initials = name.split(" ").map(w=>w[0]).join("").slice(0,2);
                          const isSel = selectedContactEmailId===e.id;
                          return (
                            <div key={e.id} className={`comms-email-row ${isSel?"selected":""} ${!e.isRead?"unread":""}`} style={{padding:"10px 14px"}} onClick={()=>setSelectedContactEmailId(isSel?null:e.id)}>
                              <div className="comms-avatar-36" style={{background:AVATAR_COLORS[(e.id||"").length%AVATAR_COLORS.length]}}>{initials}</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
                                  <div style={{fontSize:12,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
                                  <span style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--text-3)",flexShrink:0}}>{formatEmailDate(e.receivedDateTime)}</span>
                                </div>
                                <div style={{fontSize:11,color:"var(--text-3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.subject||"(No subject)"}</div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                      {contactEmailsLoading && <div style={{padding:12,textAlign:"center",fontSize:11,color:"var(--text-3)"}}>Loading…</div>}
                    </div>
                  </div>
                  <div style={{width:4,background:"var(--border)",cursor:"col-resize",flexShrink:0,transition:"background 0.15s"}} onMouseEnter={e=>{e.target.style.background="var(--blue)"}} onMouseLeave={e=>{e.target.style.background="var(--border)"}} onMouseDown={e=>handlePanelResize(e,0)}/>
                  <div className="contact-modal-mid" style={{flex:1,minWidth:300}}>
                    {selectedContactEmailId ? (()=>{
                      const email = contactEmails.find(e=>e.id===selectedContactEmailId);
                      if(!email) return <div style={{padding:20,color:"var(--text-3)"}}>Select an email</div>;
                      const bodyCache = emailBodies[email.id];
                      const loadingBody = loadingEmailBodyId === email.id;
                      const fullBody = bodyCache?.content;
                      const isHtml = (bodyCache?.contentType || "").toLowerCase() === "html";
                      return (
                        <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",minHeight:0}}>
                          <div style={{flex:1,overflowY:"auto",minHeight:0,padding:20,background:"var(--white)",borderBottom:"1px solid var(--border)",scrollBehavior:"smooth",scrollbarWidth:"thin",scrollbarColor:"var(--border) transparent"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"12px 0",borderBottom:"1px solid var(--border-2)",marginBottom:"16px"}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:4}}>{email.subject||"(No subject)"}</div>
                                <div style={{fontSize:11,color:"var(--text-3)"}}>From: {email.from?.emailAddress?.name || email.from?.name} {" < "}{email.from?.emailAddress?.address || email.from?.address}{" >"}</div>
                                <div style={{fontSize:11,color:"var(--text-3)"}}>To: {email.toRecipients?.[0]?.emailAddress?.address || email.toRecipients?.[0]?.address || "—"}</div>
                              </div>
                              <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)",textAlign:"right",flexShrink:0,marginLeft:16}}>
                                {new Date(email.receivedDateTime).toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}
                                <br/>
                                {new Date(email.receivedDateTime).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit"})}
                              </div>
                            </div>
                            {loadingBody ? (
                              <div style={{fontSize:13,color:"var(--text-3)",padding:12}}>Loading email…</div>
                            ) : fullBody != null && fullBody !== "" ? (
                              isHtml ? (
                                <div dangerouslySetInnerHTML={{__html: cleanEmailBody(fullBody)}} style={{fontSize:13,lineHeight:1.8,color:"var(--text-2)"}}/>
                              ) : (
                                <div style={{fontSize:13,lineHeight:1.8,color:"var(--text-2)",wordWrap:"break-word",overflowWrap:"break-word",whiteSpace:"pre-wrap"}}>{fullBody}</div>
                              )
                            ) : (
                              <div style={{fontSize:13,lineHeight:1.8,color:"var(--text-2)",wordWrap:"break-word",overflowWrap:"break-word",whiteSpace:"pre-wrap"}}>{email.bodyPreview||""}</div>
                            )}
                            <div style={{display:"flex",gap:8,marginTop:12}}>
                              <button type="button" className="btn-ghost" style={{fontSize:11}} onClick={()=>handleReplyToEmail(email)}>Reply</button>
                              <button type="button" className="btn-ghost" style={{fontSize:11}} onClick={()=>handleForwardEmail(email)}>Forward</button>
                            </div>
                          </div>
                        </div>
                      );
                    })() : <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-3)",fontSize:13}}>Select an email</div>}
                  </div>
                  <div style={{width:4,background:"var(--border)",cursor:"col-resize",flexShrink:0,transition:"background 0.15s"}} onMouseEnter={e=>{e.target.style.background="var(--blue)"}} onMouseLeave={e=>{e.target.style.background="var(--border)"}} onMouseDown={e=>handlePanelResize(e,1)}/>
                  <div className="contact-modal-right" style={{width:contactPanelWidths[2],flexShrink:0}}>
                    <div style={{background:"var(--white)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",padding:"16px",marginBottom:"16px",overflow:"hidden"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>Contact Details</div>
                        <button type="button" className="btn-ghost" style={{fontSize:11,padding:"3px 10px"}} onClick={()=>{ setContactForm({ name: viewingContact.name||"", type: viewingContact.type||"Client", email: viewingContact.email||"", phone: viewingContact.phone||"", address: viewingContact.address||"", company: viewingContact.company||"", is_referrer: !!viewingContact.is_referrer, referrer_fee: viewingContact.referrer_fee!=null?String(viewingContact.referrer_fee):"", formal_agreement: !!viewingContact.formal_agreement, notes: viewingContact.notes||"" }); setEditingContact(viewingContact); setViewingContact(null); setContactModal(true); }}>Edit</button>
                      </div>
                      {[["Name",viewingContact?.name],["Type",viewingContact?.type],["Email",viewingContact?.email],["Phone",viewingContact?.phone],["Address",viewingContact?.address],["Company",viewingContact?.company],["Referrer",viewingContact?.is_referrer?"Yes ★":"No"]].map(([label,value])=>(
                        <div key={label} style={{display:"flex",flexDirection:"column",padding:"6px 0",borderBottom:"1px solid var(--border-2)"}}>
                          <span style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:"2px"}}>{label}</span>
                          <span style={{fontSize:12,color:"var(--text)",wordBreak:"break-word",lineHeight:1.5}}>{value||"—"}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginBottom:8}}>✦ AI Insights</div>
                    <div className="contact-ai-card" style={{marginBottom:16}}>
                      {contactAILoading && !contactAI[viewingContact.id] ? <div className="comms-summary-shimmer" style={{height:100,borderRadius:8}}/> : contactAI[viewingContact.id] ? <div style={{fontSize:12,lineHeight:1.7,color:"var(--text-2)"}}>{renderSummaryMarkdown(contactAI[viewingContact.id])}</div> : <div style={{fontSize:11,color:"var(--text-3)"}}>Loading…</div>}
                    </div>
                    <div style={{background:"var(--white)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",padding:"16px",marginBottom:"16px"}}>
                      <div style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:"10px"}}>✦ Ask AI</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:"10px"}}>
                        {["What's outstanding?","Draft an email","Summarise history"].map((q)=>(<button key={q} type="button" className="filter-btn" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>sendContactAI(q)}>{q}</button>))}
                      </div>
                      {contactAIChat.length > 0 && (
                        <div style={{maxHeight:"200px",overflowY:"auto",marginBottom:"10px",display:"flex",flexDirection:"column",gap:"8px"}}>
                          {contactAIChat.map((m,i)=>(
                            <div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%",background:m.role==="user"?"var(--blue)":"var(--surface)",color:m.role==="user"?"white":"var(--text)",padding:"8px 12px",borderRadius:"10px",fontSize:"11px",lineHeight:1.6}}>{m.text}</div>
                          ))}
                          {contactAITyping && (
                            <div style={{alignSelf:"flex-start",background:"var(--surface)",padding:"8px 12px",borderRadius:"10px"}}>
                              <div className="ai-typing"><div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/></div>
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{display:"flex",gap:"6px"}}>
                        <input style={{flex:1,border:"1px solid var(--border)",borderRadius:"6px",padding:"7px 10px",fontSize:"11px",fontFamily:"var(--font-body)",outline:"none",color:"var(--text)"}} placeholder={`Ask about ${viewingContact?.name?.split(",")[0]||"this contact"}...`} value={contactAIChatInput} onChange={e=>setContactAIChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendContactAI()}/>
                        <button type="button" className="btn-gold" style={{fontSize:11,padding:"7px 12px"}} onClick={()=>sendContactAI()}>›</button>
                      </div>
                    </div>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginBottom:8,marginTop:16}}>Linked matters</div>
                    <div className="contact-matters-list">
                      {MATTERS.filter((m)=>m.client&&viewingContact.name&&(String(m.client).toLowerCase().includes(String(viewingContact.name).toLowerCase())||String(viewingContact.name).toLowerCase().includes(String(m.client).toLowerCase()))).length===0 ? <div style={{padding:12,textAlign:"center",color:"var(--text-3)",fontSize:11}}>No matters found</div> : MATTERS.filter((m)=>m.client&&viewingContact.name&&(String(m.client).toLowerCase().includes(String(viewingContact.name).toLowerCase())||String(viewingContact.name).toLowerCase().includes(String(m.client).toLowerCase()))).map((m)=>(
                        <div key={m.id} className="contact-matter-row" onClick={()=>{ setSelectedMatter(m.id); setPage("matter_workspace"); setMatterTab("Overview"); setViewingContact(null); }}>
                          <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-3)"}}>{m.id}</span>
                          <span className={`tag ${m.type==="Purchase"?"tag-teal":m.type==="Sale"?"tag-amber":"tag-gray"}`} style={{fontSize:9}}>{m.type}</span>
                          <span style={{fontSize:11,color:"var(--text-2)"}}>{m.stage}</span>
                          <span style={{fontSize:11,fontWeight:600,color:"var(--text)"}}>{m.price||"—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{position:"absolute",bottom:4,right:4,width:12,height:12,cursor:"se-resize",borderRight:"2px solid var(--border)",borderBottom:"2px solid var(--border)",borderRadius:"0 0 4px 0"}} onMouseDown={handleModalResize}/>
              </div>
            </div>
          )}

          {/* Matters Communications full-screen modal */}
          {mattersCommsModal && selMatterObj && (
            <div className="contact-modal-overlay" onClick={()=>{ setMattersCommsModal(false); setMatterTab("Overview"); }}>
              <div className="contact-modal" ref={mattersCommsModalRef} style={{...mattersCommsModalSize,position:"relative"}} onClick={e=>e.stopPropagation()}>
                <div style={{position:"absolute",bottom:4,right:4,width:12,height:12,cursor:"se-resize",borderRight:"2px solid var(--border)",borderBottom:"2px solid var(--border)",borderRadius:"0 0 4px 0",zIndex:10}} onMouseDown={handleMattersCommsModalResize}/>
                <div className="contact-modal-hdr">
                  <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,var(--blue),var(--ink))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"white",fontWeight:700,flexShrink:0}}>✉️</div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"var(--font-display)",fontSize:20,fontWeight:500,color:"var(--text)",letterSpacing:"-0.3px"}}>{selMatterObj.client_name || selMatterObj.client}</div>
                    <div style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)",marginTop:2}}>{selMatterObj.matter_ref || selMatterObj.id} · {selMatterObj.address}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span className={`tag ${selMatterObj.type==="Purchase"?"tag-teal":selMatterObj.type==="Sale"?"tag-amber":"tag-blue"}`}>{selMatterObj.type}</span>
                    <span className="tag tag-gray">{selMatterObj.stage}</span>
                    <button type="button" className="modal-close" onClick={()=>{ setMattersCommsModal(false); setMatterTab("Overview"); }}>✕</button>
                  </div>
                </div>
                <div style={{flexShrink:0,borderBottom:"1px solid var(--border)"}}>
                  <div className="comms-ai-bar" style={{cursor:"pointer"}} onClick={()=>setMattersCommsAISummaryExpanded(!mattersCommsAISummaryExpanded)}>
                    <span style={{fontSize:13}}>✦</span>
                    <span style={{fontSize:12,fontWeight:600,color:"var(--text)",flex:1}}>AI Summary</span>
                    {mattersCommsAISummaryLoading && <span style={{fontSize:11,color:"var(--text-3)"}}>Generating…</span>}
                    {!mattersCommsAISummaryLoading && mattersCommsAISummary && <span style={{fontSize:11,color:"var(--text-2)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:400}}>{mattersCommsAISummary.slice(0,100)}…</span>}
                    <span style={{fontSize:12,color:"var(--text-3)"}}>{mattersCommsAISummaryExpanded ? "▲" : "▼"}</span>
                  </div>
                  {mattersCommsAISummaryExpanded && mattersCommsAISummary && (
                    <div style={{padding:"14px 20px",background:"var(--gold-light)",maxHeight:250,overflowY:"auto",fontSize:12,lineHeight:1.8,color:"var(--text-2)",whiteSpace:"pre-wrap",borderBottom:"1px solid var(--border)"}}>{mattersCommsAISummary}</div>
                  )}
                </div>
                <div style={{flex:1,overflow:"hidden",display:"flex",minHeight:0}}>
                  <div style={{width:mattersCommsPanelWidths[0],flexShrink:0,display:"flex",flexDirection:"column",overflow:"hidden",borderRight:"1px solid var(--border)",background:"var(--white)"}}>
                    <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <span style={{fontSize:13,fontWeight:700,color:"var(--text)",flex:1}}>Emails</span>
                        <button type="button" style={{width:28,height:28,border:"1px solid var(--border)",borderRadius:6,background:"var(--surface)",cursor:"pointer",fontSize:11}} onClick={()=>setMattersCommsSortAsc(!mattersCommsSortAsc)} title={mattersCommsSortAsc?"Newest first":"Oldest first"}>{mattersCommsSortAsc?"↑":"↓"}</button>
                        <button type="button" style={{width:28,height:28,border:"1px solid var(--border)",borderRadius:6,background:"var(--surface)",cursor:"pointer",fontSize:14}} onClick={fetchMattersCommsEmails}>↺</button>
                      </div>
                      <div style={{display:"flex",gap:6,marginBottom:8}}>
                        {["all","inbox","sent"].map(t=>(<button key={t} type="button" className={`filter-btn ${mattersCommsTab===t?"active":""}`} style={{fontSize:10,padding:"3px 10px",textTransform:"capitalize"}} onClick={()=>setMattersCommsTab(t)}>{t}</button>))}
                      </div>
                      <input style={{width:"100%",border:"1px solid var(--border)",borderRadius:6,padding:"6px 10px",fontSize:11,outline:"none",fontFamily:"var(--font-body)"}} placeholder="Search emails…" value={mattersCommsSearch} onChange={e=>setMattersCommsSearch(e.target.value)}/>
                    </div>
                    <div style={{flex:1,overflowY:"auto",minHeight:0}}>
                      {mattersCommsLoading ? (
                        <div style={{padding:20,textAlign:"center",color:"var(--text-3)",fontSize:12}}>Loading emails…</div>
                      ) : (()=>{
                        const MAILBOX = (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL) ? process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL : "";
                        const filtered = mattersCommsEmails
                          .filter(e=>{ if (mattersCommsTab==="inbox") return (e.isOutgoing === false) || (e.from?.emailAddress?.address?.toLowerCase() !== MAILBOX.toLowerCase()); if (mattersCommsTab==="sent") return (e.isOutgoing === true) || (e.from?.emailAddress?.address?.toLowerCase() === MAILBOX.toLowerCase()); return true; })
                          .filter(e=>!mattersCommsSearch || (e.subject||"").toLowerCase().includes(mattersCommsSearch.toLowerCase()) || (e.from?.emailAddress?.name||e.from?.name||"").toLowerCase().includes(mattersCommsSearch.toLowerCase()))
                          .sort((a,b)=>{ const diff = new Date(a.receivedDateTime) - new Date(b.receivedDateTime); return mattersCommsSortAsc ? diff : -diff; });
                        if (!filtered.length) return <div style={{padding:20,textAlign:"center",color:"var(--text-3)",fontSize:12}}>No emails found</div>;
                        return filtered.map(e=>{
                          const initials = (e.from?.emailAddress?.name||e.from?.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
                          const ci = (initials.charCodeAt(0)||0) % (AVATAR_COLORS.length||1);
                          const isSelected = mattersCommsEmailId === e.id;
                          return (
                            <div key={e.id} className="comms-email-row" style={{background:isSelected?"var(--ink)":"var(--white)",color:isSelected?"white":"var(--text)",borderLeft:!e.isRead&&!isSelected?"3px solid var(--gold)":"3px solid transparent",padding:"12px 14px",borderBottom:"1px solid var(--border-2)",cursor:"pointer",display:"flex",gap:10,alignItems:"flex-start",transition:"all 0.12s"}} onClick={()=>setMattersCommsEmailId(e.id)}>
                              <div style={{width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${AVATAR_COLORS[ci]},${AVATAR_COLORS[(ci+1)%AVATAR_COLORS.length]})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"white",flexShrink:0}}>{initials}</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                                  <span style={{fontSize:12,fontWeight:e.isRead?500:700,color:isSelected?"white":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>{e.from?.emailAddress?.name||e.from?.name||e.from?.emailAddress?.address}</span>
                                  <span style={{fontSize:9,fontFamily:"var(--font-mono)",color:isSelected?"rgba(255,255,255,0.6)":"var(--text-3)",flexShrink:0,marginLeft:4}}>{formatEmailDate(e.receivedDateTime)}</span>
                                </div>
                                <div style={{fontSize:11,color:isSelected?"rgba(255,255,255,0.8)":"var(--text-2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>{e.subject}</div>
                                <div style={{fontSize:10,color:isSelected?"rgba(255,255,255,0.5)":"var(--text-3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.bodyPreview?.slice(0,60)}</div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                  <div style={{width:4,background:"var(--border-2)",cursor:"col-resize",flexShrink:0}} onMouseDown={e=>handleMattersCommsPanelResize(e,0)}/>
                  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:300,background:"var(--surface)"}}>
                    {(()=>{
                      const email = mattersCommsEmails.find(e=>e.id===mattersCommsEmailId);
                      if (!email) return (
                        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8,color:"var(--text-3)"}}>
                          <div style={{fontSize:32,opacity:0.2}}>✉️</div>
                          <div style={{fontSize:12}}>Select an email to view</div>
                        </div>
                      );
                      const bodyCache = emailBodies[email.id];
                      const loadingBody = loadingEmailBodyId === email.id;
                      const fullBody = bodyCache?.content;
                      const isHtml = (bodyCache?.contentType||"").toLowerCase()==="html";
                      return (
                        <>
                          <div style={{flex:1,overflowY:"auto",minHeight:0,padding:20,background:"var(--white)"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"0 0 14px",borderBottom:"1px solid var(--border-2)",marginBottom:16}}>
                              <div style={{flex:1}}>
                                <div style={{fontSize:15,fontWeight:700,color:"var(--text)",marginBottom:6}}>{email.subject}</div>
                                <div style={{fontSize:11,color:"var(--text-3)",marginBottom:2}}>From: {email.from?.emailAddress?.name||email.from?.name} &lt;{email.from?.emailAddress?.address||email.from?.address}&gt;</div>
                                <div style={{fontSize:11,color:"var(--text-3)"}}>To: {email.toRecipients?.[0]?.emailAddress?.address||email.toRecipients?.[0]?.address||"—"}</div>
                              </div>
                              <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)",textAlign:"right",flexShrink:0,marginLeft:16}}>
                                {new Date(email.receivedDateTime).toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}<br/>{new Date(email.receivedDateTime).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit"})}
                              </div>
                            </div>
                            {loadingBody ? <div style={{fontSize:13,color:"var(--text-3)",padding:12}}>Loading email…</div> : fullBody != null && fullBody !== "" ? (isHtml ? <div dangerouslySetInnerHTML={{__html:cleanEmailBody(fullBody)}} style={{fontSize:13,lineHeight:1.8,color:"var(--text-2)"}}/> : <div style={{fontSize:13,lineHeight:1.8,color:"var(--text-2)",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{fullBody}</div>) : <div style={{fontSize:13,lineHeight:1.8,color:"var(--text-2)",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{email.bodyPreview||""}</div>}
                            <div style={{display:"flex",gap:8,marginTop:16,paddingTop:12,borderTop:"1px solid var(--border-2)"}}>
                              <button type="button" className="btn-ghost" style={{fontSize:11}} onClick={()=>{ const sender = email.from?.emailAddress?.address||email.from?.address; const myEmail = (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL) ? process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL : ""; const to = sender&&myEmail&&sender.toLowerCase()===myEmail.toLowerCase() ? (email.toRecipients?.[0]?.emailAddress?.address||email.toRecipients?.[0]?.address) : sender; setComposeTo(to||""); setComposeSubject((email.subject||"").startsWith("Re:")?email.subject:"Re: "+(email.subject||"")); setComposeBody(""); setComposeModal(true); }}>↩ Reply</button>
                              <button type="button" className="btn-ghost" style={{fontSize:11}} onClick={()=>{ setComposeTo(""); setComposeSubject((email.subject||"").startsWith("Fwd:")?email.subject:"Fwd: "+(email.subject||"")); setComposeBody("\n\n-------- Forwarded Message --------\nFrom: "+(email.from?.emailAddress?.name||email.from?.name)+"\nDate: "+new Date(email.receivedDateTime).toLocaleDateString("en-AU")+"\nSubject: "+(email.subject||"")+"\n\n"+(email.bodyPreview||"")); setComposeModal(true); }}>→ Forward</button>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div style={{width:4,background:"var(--border-2)",cursor:"col-resize",flexShrink:0}} onMouseDown={e=>handleMattersCommsPanelResize(e,1)}/>
                  <div style={{width:mattersCommsPanelWidths[2],flexShrink:0,overflowY:"auto",padding:16,background:"var(--white)",borderLeft:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{background:"var(--surface)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",padding:14}}>
                      <div style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:10}}>Matter Details</div>
                      {[["Client",selMatterObj.client_name||selMatterObj.client],["Type",selMatterObj.type],["Stage",selMatterObj.stage],["Value",selMatterObj.price],["Settlement",selMatterObj.settlement]].map(([label,value])=>(<div key={label} style={{display:"flex",flexDirection:"column",padding:"5px 0",borderBottom:"1px solid var(--border-2)"}}><span style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:1}}>{label}</span><span style={{fontSize:12,color:"var(--text)",wordBreak:"break-word"}}>{value||"—"}</span></div>))}
                    </div>
                    <div style={{background:"var(--gold-light)",borderRadius:"var(--radius-lg)",border:"1px solid var(--gold-dim)",padding:14}}>
                      <div style={{fontFamily:"var(--font-display)",fontSize:14,fontWeight:500,color:"var(--text)",marginBottom:10}}>✦ AI Insights</div>
                      {mattersCommsAISummaryLoading ? <div style={{fontSize:11,color:"var(--text-3)"}}>Analysing communications…</div> : mattersCommsAISummary ? <div style={{fontSize:12,lineHeight:1.75,color:"var(--text-2)",whiteSpace:"pre-wrap"}}>{mattersCommsAISummary}</div> : <div style={{fontSize:11,color:"var(--text-3)"}}>No summary yet — refresh emails to generate</div>}
                    </div>
                    <div style={{background:"var(--white)",borderRadius:"var(--radius-lg)",border:"1px solid var(--border)",padding:14,flex:1,display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1.5px"}}>✦ Ask AI</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {["What's due?","Draft update","Any risks?","Summarise emails"].map(q=>(<button key={q} type="button" className="filter-btn" style={{fontSize:10,padding:"3px 9px"}} onClick={()=>sendMattersCommsAI(q)}>{q}</button>))}
                      </div>
                      {mattersCommsAIChat.length > 0 && (
                        <div style={{flex:1,maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
                          {mattersCommsAIChat.map((m,i)=>(<div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"88%",background:m.role==="user"?"var(--blue-light)":"var(--surface)",color:m.role==="user"?"var(--blue)":"var(--text)",border:"1px solid var(--border)",padding:"7px 11px",borderRadius:8,fontSize:11,lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{m.text}</div>))}
                          {mattersCommsAITyping && (<div style={{alignSelf:"flex-start",background:"var(--surface)",border:"1px solid var(--border)",padding:"7px 11px",borderRadius:8}}><div className="ai-typing"><div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/></div></div>)}
                        </div>
                      )}
                      <div style={{display:"flex",gap:6,marginTop:"auto"}}>
                        <input style={{flex:1,border:"1px solid var(--border)",borderRadius:6,padding:"6px 10px",fontSize:11,fontFamily:"var(--font-body)",outline:"none",color:"var(--text)",background:"var(--surface)"}} placeholder="Ask about this matter…" value={mattersCommsAIChatInput} onChange={e=>setMattersCommsAIChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMattersCommsAI()}/>
                        <button type="button" className="btn-gold" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>sendMattersCommsAI()}>›</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              COMMUNICATIONS
          ══════════════════════════════════════════════ */}
          {page === "communications" && (
            <div className="comms-page" style={isMobile ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } : undefined}>
              {isMobile && mobileCommsView === "detail" && commsPageSelectedEmailId ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--white)" }}>
                  <div style={{ flexShrink: 0, padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                    <button type="button" className="btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setMobileCommsView("list")}>← Back</button>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(allEmails.find((e) => e.id === commsPageSelectedEmailId))?.subject || "Email"}</span>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                    {(() => {
                      const email = allEmails.find((e) => e.id === commsPageSelectedEmailId);
                      if (!email) return <div style={{ padding: 20, color: "var(--text-3)" }}>Select an email</div>;
                      const bodyCache = emailBodies[email.id];
                      const loadingBody = loadingEmailBodyId === email.id;
                      const fullBody = bodyCache?.content;
                      const isHtml = (bodyCache?.contentType || "").toLowerCase() === "html";
                      return (
                        <>
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{email.subject}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>From: {email.from?.name || email.from?.emailAddress?.name} &lt;{email.from?.address || email.from?.emailAddress?.address}&gt;</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)" }}>To: {email.toRecipients?.[0]?.address || email.toRecipients?.[0]?.emailAddress?.address || "—"}</div>
                            <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)", marginTop: 4 }}>{new Date(email.receivedDateTime).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} {new Date(email.receivedDateTime).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}</div>
                          </div>
                          {loadingBody ? <div style={{ fontSize: 13, color: "var(--text-3)", padding: 12 }}>Loading email…</div> : fullBody != null && fullBody !== "" ? (isHtml ? <div dangerouslySetInnerHTML={{ __html: cleanEmailBody(fullBody) }} style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-2)" }} /> : <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{fullBody}</div>) : <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{email.bodyPreview || ""}</div>}
                          <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border-2)" }}>
                            <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => { const sender = email.from?.address || email.from?.emailAddress?.address; const myEmail = (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL) ? process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL : ""; const to = sender && myEmail && sender.toLowerCase() === myEmail.toLowerCase() ? (email.toRecipients?.[0]?.address || email.toRecipients?.[0]?.emailAddress?.address) : sender; setComposeTo(to || ""); setComposeSubject((email.subject || "").startsWith("Re:") ? email.subject : "Re: " + (email.subject || "")); setComposeBody(""); setComposeModal(true); }}>↩ Reply</button>
                            <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => { setComposeTo(""); setComposeSubject((email.subject || "").startsWith("Fwd:") ? email.subject : "Fwd: " + (email.subject || "")); setComposeBody("\n\n-------- Forwarded Message --------\nFrom: " + (email.from?.name || email.from?.emailAddress?.name) + "\nDate: " + new Date(email.receivedDateTime).toLocaleDateString("en-AU") + "\nSubject: " + (email.subject || "") + "\n\n" + (email.bodyPreview || "")); setComposeModal(true); }}>→ Forward</button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
              <>
              <div className="comms-page-left" style={{ width: isMobile ? "100%" : commsPanelWidths[0], flexShrink: 0 }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1 }}>Communications</span>
                    {(allEmails.filter((e) => !e.isRead).length) > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, background: "var(--blue)", color: "white", padding: "2px 6px", borderRadius: 10 }}>{allEmails.filter((e) => !e.isRead).length}</span>
                    )}
                    <button type="button" style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", cursor: "pointer", fontSize: 11 }} onClick={() => setCommsSortAsc(!commsSortAsc)} title={commsSortAsc ? "Newest first" : "Oldest first"}>{commsSortAsc ? "↑" : "↓"}</button>
                    <button type="button" style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", cursor: "pointer", fontSize: 14 }} onClick={fetchAllEmails}>↺</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {(() => {
                      const MAILBOX = process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL || "gitu@conveyancingcrew.com.au";
                      const inboxCount = allEmails.filter((e) => (e.from?.emailAddress?.address || e.from?.address || "").toLowerCase() !== MAILBOX.toLowerCase()).length;
                      const sentCount = allEmails.filter((e) => (e.from?.emailAddress?.address || e.from?.address || "").toLowerCase() === MAILBOX.toLowerCase()).length;
                      return [
                        { t: "all", label: "All", count: allEmails.length },
                        { t: "inbox", label: "Inbox", count: inboxCount },
                        { t: "sent", label: "Sent", count: sentCount }
                      ].map(({ t, label, count }) => (
                        <button key={t} type="button" className={`filter-btn ${commsTab === t ? "active" : ""}`} style={{ fontSize: 10, padding: "3px 10px" }} onClick={() => setCommsTab(t)}>{label} ({count})</button>
                      ));
                    })()}
                  </div>
                  <input style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 11, outline: "none", fontFamily: "var(--font-body)" }} placeholder="Search emails…" value={commsSearch} onChange={(e) => setCommsSearch(e.target.value)} />
                </div>
                <div style={{ flex: 1, overflowY: "scroll", minHeight: 0 }}>
                  {allEmailsLoading ? (
                    <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>Loading emails…</div>
                  ) : (() => {
                    const MAILBOX = process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL || "gitu@conveyancingcrew.com.au";
                    const filteredCommsEmails = allEmails
                      .filter((e) => {
                        const fromAddress = (e.from?.emailAddress?.address || e.from?.address || "").toLowerCase();
                        const isFromMe = fromAddress === MAILBOX.toLowerCase();
                        if (commsTab === "inbox") return !isFromMe;
                        if (commsTab === "sent") return isFromMe;
                        return true;
                      })
                      .filter((e) => {
                        if (!commsSearch) return true;
                        const searchLower = commsSearch.toLowerCase();
                        return (
                          e.subject?.toLowerCase().includes(searchLower) ||
                          (e.from?.emailAddress?.name || e.from?.name)?.toLowerCase().includes(searchLower) ||
                          (e.from?.emailAddress?.address || e.from?.address)?.toLowerCase().includes(searchLower) ||
                          e.bodyPreview?.toLowerCase().includes(searchLower)
                        );
                      })
                      .sort((a, b) => {
                        const diff = new Date(a.receivedDateTime) - new Date(b.receivedDateTime);
                        return commsSortAsc ? diff : -diff;
                      });
                    if (!filteredCommsEmails.length) return <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No emails found</div>;
                    const MAILBOX_EMAIL = process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL || "gitu@conveyancingcrew.com.au";
                    return Object.entries(groupEmailsByDate(filteredCommsEmails)).map(([dateLabel, emails]) => (
                      <div key={dateLabel}>
                        <div style={{
                          padding: "6px 14px",
                          fontSize: 9,
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-3)",
                          textTransform: "uppercase",
                          letterSpacing: "1.5px",
                          background: "var(--surface)",
                          borderBottom: "1px solid var(--border-2)",
                          borderTop: "1px solid var(--border-2)",
                          position: "sticky",
                          top: 0,
                          zIndex: 1
                        }}>
                          {dateLabel}
                        </div>
                        {emails.map((e) => {
                          const initials = (e.from?.emailAddress?.name || e.from?.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                          const ci = (initials.charCodeAt(0) || 0) % (AVATAR_COLORS.length || 1);
                          const isSelected = commsPageSelectedEmailId === e.id;
                          const isFromMe = (e.from?.emailAddress?.address || e.from?.address || "").toLowerCase() === MAILBOX_EMAIL.toLowerCase();
                          return (
                            <div
                              key={e.id}
                              style={{
                                padding: "11px 14px",
                                borderBottom: "1px solid var(--border-2)",
                                cursor: "pointer",
                                background: isSelected ? "var(--ink)" : "var(--white)",
                                borderLeft: !e.isRead && !isSelected ? "3px solid var(--blue)" : "3px solid transparent",
                                transition: "all 0.12s",
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start"
                              }}
                              onMouseEnter={(ev) => { if (!isSelected) ev.currentTarget.style.background = "var(--surface)"; }}
                              onMouseLeave={(ev) => { if (!isSelected) ev.currentTarget.style.background = "var(--white)"; }}
                              onClick={() => { setCommsPageSelectedEmailId(e.id); if (isMobile) setMobileCommsView("detail"); }}
                            >
                              <div style={{
                                width: 34, height: 34, borderRadius: "50%",
                                background: isFromMe ? "linear-gradient(135deg,var(--blue),#1a4a9e)" : `linear-gradient(135deg,${AVATAR_COLORS[ci]},${AVATAR_COLORS[(ci + 1) % AVATAR_COLORS.length]})`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 11, fontWeight: 700, color: "white", flexShrink: 0
                              }}>
                                {isFromMe ? "G" : initials}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: isSelected ? "rgba(255,255,255,0.9)" : "var(--text)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  marginBottom: 2,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4
                                }}>
                                  <span style={{
                                    fontSize: 9,
                                    fontFamily: "var(--font-mono)",
                                    color: isSelected ? "rgba(255,255,255,0.4)" : "var(--text-3)",
                                    flexShrink: 0
                                  }}>
                                    {isFromMe ? "TO" : "FROM"}
                                  </span>
                                  <span style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                  }}>
                                    {isFromMe
                                      ? (e.toRecipients?.[0]?.name || e.toRecipients?.[0]?.emailAddress?.name || e.toRecipients?.[0]?.address || e.toRecipients?.[0]?.emailAddress?.address || "Unknown")
                                      : (e.from?.name || e.from?.emailAddress?.name || e.from?.address || e.from?.emailAddress?.address || "Unknown")}
                                  </span>
                                  <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: isSelected ? "rgba(255,255,255,0.4)" : "var(--text-3)", flexShrink: 0, marginLeft: "auto" }}>
                                    {new Date(e.receivedDateTime).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </div>
                                <div style={{
                                  fontSize: 11,
                                  fontWeight: !e.isRead && !isSelected ? 600 : 400,
                                  color: isSelected ? "rgba(255,255,255,0.85)" : "var(--text)",
                                  overflow: "hidden", textOverflow: "ellipsis",
                                  whiteSpace: "nowrap", marginBottom: 2
                                }}>
                                  {e.subject || "(No subject)"}
                                </div>
                                <div style={{
                                  fontSize: 10,
                                  color: isSelected ? "rgba(255,255,255,0.5)" : "var(--text-3)",
                                  overflow: "hidden", textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}>
                                  {e.bodyPreview?.slice(0, 60)}
                                </div>
                              </div>
                              {!e.isRead && !isSelected && (
                                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--blue)", flexShrink: 0, marginTop: 4 }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              </div>
              {!isMobile && (
              <>
              <div className="comms-page-divider" onMouseDown={(e) => handleCommsPanelResize(e, 0)} />
              <div className="comms-page-mid">
                {(() => {
                  const email = allEmails.find((e) => e.id === commsPageSelectedEmailId);
                  if (!email) return (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-3)" }}>
                      <div style={{ fontSize: 48, opacity: 0.2 }}>✉️</div>
                      <div style={{ fontSize: 12 }}>Select an email</div>
                    </div>
                  );
                  const bodyCache = emailBodies[email.id];
                  const loadingBody = loadingEmailBodyId === email.id;
                  const fullBody = bodyCache?.content;
                  const isHtml = (bodyCache?.contentType || "").toLowerCase() === "html";
                  return (
                    <>
                      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 20, background: "var(--white)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "0 0 14px", borderBottom: "1px solid var(--border-2)", marginBottom: 16 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{email.subject}</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>From: {email.from?.name || email.from?.emailAddress?.name} &lt;{email.from?.address || email.from?.emailAddress?.address}&gt;</div>
                            <div style={{ fontSize: 11, color: "var(--text-3)" }}>To: {email.toRecipients?.[0]?.address || email.toRecipients?.[0]?.emailAddress?.address || "—"}</div>
                          </div>
                          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)", textAlign: "right", flexShrink: 0, marginLeft: 16 }}>
                            {new Date(email.receivedDateTime).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}<br />{new Date(email.receivedDateTime).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        {loadingBody ? <div style={{ fontSize: 13, color: "var(--text-3)", padding: 12 }}>Loading email…</div> : fullBody != null && fullBody !== "" ? (isHtml ? <div dangerouslySetInnerHTML={{ __html: cleanEmailBody(fullBody) }} style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-2)" }} /> : <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{fullBody}</div>) : <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{email.bodyPreview || ""}</div>}
                        <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border-2)" }}>
                          <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => { const sender = email.from?.address || email.from?.emailAddress?.address; const myEmail = (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL) ? process.env.NEXT_PUBLIC_MICROSOFT_MAILBOX_EMAIL : ""; const to = sender && myEmail && sender.toLowerCase() === myEmail.toLowerCase() ? (email.toRecipients?.[0]?.address || email.toRecipients?.[0]?.emailAddress?.address) : sender; setComposeTo(to || ""); setComposeSubject((email.subject || "").startsWith("Re:") ? email.subject : "Re: " + (email.subject || "")); setComposeBody(""); setComposeModal(true); }}>↩ Reply</button>
                          <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => { setComposeTo(""); setComposeSubject((email.subject || "").startsWith("Fwd:") ? email.subject : "Fwd: " + (email.subject || "")); setComposeBody("\n\n-------- Forwarded Message --------\nFrom: " + (email.from?.name || email.from?.emailAddress?.name) + "\nDate: " + new Date(email.receivedDateTime).toLocaleDateString("en-AU") + "\nSubject: " + (email.subject || "") + "\n\n" + (email.bodyPreview || "")); setComposeModal(true); }}>→ Forward</button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="comms-page-divider" onMouseDown={(e) => handleCommsPanelResize(e, 1)} />
              <div style={{ width: commsPanelWidths[2], flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--ink)", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "2px" }}>✦ AI Insights</div>
                  <button type="button" style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer" }} onClick={() => generateCommsPageSummary(allEmails)}>↺ Refresh</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "14px 16px" }}>
                  {commsPageAISummaryLoading ? (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.8 }}>
                      <div style={{ marginBottom: 8 }}>Analysing your inbox…</div>
                      <div className="ai-typing">
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                      </div>
                    </div>
                  ) : commsPageAISummary ? (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.85, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{commsPageAISummary}</div>
                  ) : (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", padding: "30px 10px" }}>
                      <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>✦</div>
                      Load emails to generate AI insights
                    </div>
                  )}
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, padding: "10px 14px" }}>
                  <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8 }}>Ask AI</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {["What needs a reply?", "Any urgent emails?", "Draft a response", "Match to matters"].map((q) => (
                      <button key={q} type="button" style={{ fontSize: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "3px 8px", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "var(--font-body)" }} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }} onClick={() => sendCommsPageAI(q)}>{q}</button>
                    ))}
                  </div>
                  {commsPageAIChat.length > 0 && (
                    <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                      {commsPageAIChat.map((m, i) => (
                        <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", background: m.role === "user" ? "rgba(36,94,176,0.3)" : "rgba(255,255,255,0.06)", color: m.role === "user" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.08)", padding: "7px 11px", borderRadius: 8, fontSize: 11, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>
                      ))}
                      {commsPageAITyping && (
                        <div style={{ alignSelf: "flex-start", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", padding: "7px 11px", borderRadius: 8 }}>
                          <div className="ai-typing">
                            <div className="typing-dot" />
                            <div className="typing-dot" />
                            <div className="typing-dot" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, padding: "7px 10px", fontSize: 11, color: "rgba(255,255,255,0.8)", outline: "none", fontFamily: "var(--font-body)" }} placeholder="Ask about your emails…" value={commsPageAIChatInput} onChange={(e) => setCommsPageAIChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendCommsPageAI()} />
                    <button type="button" style={{ background: "linear-gradient(135deg,var(--blue),#1a4a9e)", color: "white", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer", flexShrink: 0 }} onClick={() => sendCommsPageAI()}>›</button>
                  </div>
                </div>
              </div>
              </>
              )}
              </>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════
              ACCOUNTING
          ══════════════════════════════════════════════ */}
          {page === "accounting" && (
            <div className="content">
              {!xeroConnected && !xeroLoading && (
                <div
                  style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-lg)",
                    border: "2px dashed var(--border)",
                    padding: "40px",
                    textAlign: "center",
                    marginBottom: 20,
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 18,
                      color: "var(--text)",
                      marginBottom: 6,
                    }}
                  >
                    Connect to Xero
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>
                    Connect your Xero account to see Profit &amp; Loss, bank/revenue accounts, and activity
                  </div>
                  <button type="button" className="btn-gold" onClick={() => { window.location.href = "/api/xero/auth"; }}>
                    Connect Xero →
                  </button>
                </div>
              )}

              {xeroLoading && !xeroData && (
                <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="ai-typing">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                  Loading Xero data…
                </div>
              )}

              {xeroConnected && xeroData && (() => {
                const fyPl = parseXeroProfitAndLoss(xeroData.financialYear?.report);
                const cmPl = parseXeroProfitAndLoss(xeroData.currentMonth?.report);
                const cqPl = parseXeroProfitAndLoss(xeroData.currentQuarter?.report);
                const prevMonthReport =
                  xeroData.previousMonth?.report ??
                  (xeroData.monthlyData?.length >= 2
                    ? xeroData.monthlyData[xeroData.monthlyData.length - 2]?.report
                    : null);
                const prevPl = prevMonthReport ? parseXeroProfitAndLoss(prevMonthReport) : null;
                const cm = xeroData.currentMonth || {};
                const fy = xeroData.financialYear || {};
                const periodData =
                  xeroPeriod === "monthly"
                    ? xeroData?.currentMonth
                    : xeroPeriod === "quarterly"
                      ? xeroData?.currentQuarter
                      : xeroData?.financialYear;
                const periodPl =
                  xeroPeriod === "monthly" ? cmPl : xeroPeriod === "quarterly" ? cqPl : fyPl;
                const periodTitle =
                  xeroPeriod === "monthly"
                    ? "This Month"
                    : xeroPeriod === "quarterly"
                      ? "This Quarter"
                      : "This Financial Year";
                const statRevenue = periodData?.income ?? periodPl.totalIncome;
                const statExpenses = periodData?.expenses ?? periodPl.totalExpenses;
                const statProfit = periodData?.profit ?? periodPl.netProfit;
                const statFourth = fy.income ?? fyPl.totalIncome;
                let revPct = null;
                if (
                  xeroPeriod === "monthly" &&
                  prevPl &&
                  prevPl.totalIncome > 0
                ) {
                  const curRev = cm.income ?? cmPl.totalIncome;
                  revPct = ((curRev - prevPl.totalIncome) / prevPl.totalIncome) * 100;
                }
                const statSub1 =
                  xeroPeriod === "monthly"
                    ? "Calendar month to date"
                    : xeroPeriod === "quarterly"
                      ? "Current quarter to date"
                      : "Financial year to date (AU)";
                const statSub4 = `AU FY Jul 1 – ${xeroData.financialYear?.to || xeroData.financialYear?.toDate || "today"}`;
                const seriesRaw =
                  xeroData.chartData?.length > 0
                    ? xeroData.chartData
                    : xeroPeriod === "quarterly"
                      ? xeroData.quarterlyData || []
                      : xeroPeriod === "yearly"
                        ? xeroData.yearlyData || []
                        : xeroData.monthlyData || [];
                const chartData = seriesRaw.map((m) => ({
                  month: m.month,
                  from: m.from,
                  to: m.to,
                  ...extractPlSeriesFromReport(m.report),
                }));
                const chartWidth = isMobile ? 360 : 800;
                const chartHeight = isMobile ? 220 : 280;
                const pad = isMobile
                  ? { top: 16, right: 10, bottom: 36, left: 44 }
                  : { top: 20, right: 24, bottom: 44, left: 64 };
                const innerW = chartWidth - pad.left - pad.right;
                const innerH = chartHeight - pad.top - pad.bottom;
                const len = Math.max(chartData.length, 1);
                const minVal = Math.min(...chartData.map((d) => d.profit), 0);
                const maxVal = Math.max(
                  ...chartData.map((d) => Math.max(d.income, d.expenses)),
                  1
                );
                const range = Math.max(maxVal - minVal, 1e-9);
                const slotW = innerW / len;
                const barW = slotW / 2.7;
                const cx = (i) => pad.left + (i + 0.5) * slotW;
                const getY = (v) =>
                  pad.top + innerH - ((v - minVal) / range) * innerH;
                const fmtAxis = (v) => {
                  const neg = v < 0;
                  const abs = Math.abs(v);
                  let s;
                  if (abs >= 1e6) s = `$${(abs / 1e6).toFixed(1)}M`;
                  else if (abs >= 1e3) s = `$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
                  else s = `$${Math.round(abs)}`;
                  return neg ? `-${s}` : s;
                };
                const profitPathD = chartData.length
                  ? chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${cx(i)} ${getY(d.profit)}`).join(" ")
                  : "";
                const incTotal = Math.max(fyPl.totalIncome, 1);
                const expTotal = Math.max(fyPl.totalExpenses, 1);
                const expSorted = [...fyPl.expenseLineItems].sort(
                  (a, b) =>
                    (parseFloat(String(b.amount).replace(/[^0-9.-]/g, "")) || 0) -
                    (parseFloat(String(a.amount).replace(/[^0-9.-]/g, "")) || 0)
                );
                const tip = xeroChartHoverIdx != null ? chartData[xeroChartHoverIdx] : null;
                const tipLeftPct =
                  tip != null && len
                    ? ((pad.left + (xeroChartHoverIdx + 0.5) * slotW) / chartWidth) * 100
                    : 50;
                const revenuePieData = (xeroData?.incomeRows || [])
                  .map((r) => ({
                    label: r.Cells?.[0]?.Value || "",
                    value:
                      parseFloat(
                        String(r.Cells?.[1]?.Value ?? "0").replace(/[^0-9.-]/g, "")
                      ) || 0,
                  }))
                  .filter((d) => d.value > 0 && d.label);
                const expensePieData = (xeroData?.expenseRows || [])
                  .map((r) => ({
                    label: r.Cells?.[0]?.Value || "",
                    value:
                      parseFloat(
                        String(r.Cells?.[1]?.Value ?? "0").replace(/[^0-9.-]/g, "")
                      ) || 0,
                  }))
                  .filter((d) => d.value > 0 && d.label);
                return (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 14,
                        marginBottom: 22,
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <div
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: 26,
                            fontWeight: 500,
                            color: "var(--text)",
                            letterSpacing: "-0.5px",
                          }}
                        >
                          Accounting
                        </div>
                        <div className="xero-badge" style={{ fontSize: 10, padding: "4px 12px" }}>
                          ✓ Xero Connected
                        </div>
                        {xeroLoading && (
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Refreshing…</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div className="acc-period-toggle" role="group" aria-label="Period">
                          {[
                            { id: "monthly", label: "Monthly" },
                            { id: "quarterly", label: "Quarterly" },
                            { id: "yearly", label: "Yearly" },
                          ].map(({ id, label }) => (
                            <button
                              key={id}
                              type="button"
                              className={`acc-period-btn ${xeroPeriod === id ? "active" : ""}`}
                              onClick={() => setXeroPeriod(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ fontSize: 12 }}
                          onClick={() => window.open("https://go.xero.com", "_blank", "noopener,noreferrer")}
                        >
                          View in Xero
                        </button>
                        <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => fetchXeroData()}>
                          ↺ Refresh
                        </button>
                      </div>
                    </div>

                    <div
                      className="acc-grid"
                      style={{
                        gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, 1fr)",
                        marginBottom: 22,
                      }}
                    >
                      <div className="acc-stat">
                        <div className="acc-stat-icon">📈</div>
                        <div className="acc-stat-label">{`Revenue ${periodTitle}`}</div>
                        <div
                          className="acc-stat-val"
                          style={{
                            color: "var(--green)",
                            display: "flex",
                            alignItems: "baseline",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          <span>{formatPlCurrency(statRevenue)}</span>
                          {revPct != null && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 8,
                                background: revPct >= 0 ? "var(--green-light)" : "var(--red-light)",
                                color: revPct >= 0 ? "var(--green)" : "var(--red)",
                              }}
                            >
                              {revPct >= 0 ? "+" : ""}
                              {revPct.toFixed(0)}% vs last month
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{statSub1}</div>
                      </div>
                      <div className="acc-stat">
                        <div className="acc-stat-icon">📉</div>
                        <div className="acc-stat-label">{`Expenses ${periodTitle}`}</div>
                        <div className="acc-stat-val" style={{ color: "var(--red)" }}>
                          {formatPlCurrency(statExpenses)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{statSub1}</div>
                      </div>
                      <div className="acc-stat">
                        <div className="acc-stat-icon">⚖️</div>
                        <div className="acc-stat-label">{`Net Profit ${periodTitle}`}</div>
                        <div
                          className="acc-stat-val"
                          style={{ color: (statProfit ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}
                        >
                          {formatPlCurrency(statProfit)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{statSub1}</div>
                      </div>
                      <div className="acc-stat">
                        <div className="acc-stat-icon">🏛️</div>
                        <div className="acc-stat-label">Financial Year Revenue</div>
                        <div className="acc-stat-val" style={{ color: "var(--blue)" }}>
                          {formatPlCurrency(statFourth)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{statSub4}</div>
                      </div>
                    </div>

                    <div className="acc-chart-card">
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 15, marginBottom: 14, color: "var(--text)" }}>
                        Revenue &amp; expenses over time
                      </div>
                      <div className="acc-chart-wrap" style={{ minHeight: chartHeight }}>
                        {tip && (
                          <div
                            className="acc-chart-tooltip"
                            style={{
                              left: `clamp(8px, calc(${tipLeftPct}% - 72px), calc(100% - 168px))`,
                              top: 6,
                            }}
                          >
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>{tip.month}</div>
                            <div>Revenue: {formatPlCurrency(tip.income)}</div>
                            <div>Expenses: {formatPlCurrency(tip.expenses)}</div>
                            <div>Net profit: {formatPlCurrency(tip.profit)}</div>
                          </div>
                        )}
                        <svg
                          className="acc-chart-svg"
                          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                          width="100%"
                          height={chartHeight}
                          preserveAspectRatio="xMidYMid meet"
                          style={{ display: "block" }}
                          onMouseLeave={() => {
                            setXeroChartHoverIdx(null);
                            setXeroAccBarHover(null);
                          }}
                          role="img"
                          aria-label="Revenue expenses and profit chart"
                        >
                          {[0, 1, 2, 3, 4, 5].map((k) => {
                            const t = k / 5;
                            const val = minVal + (maxVal - minVal) * (1 - t);
                            const y = getY(val);
                            return (
                              <g key={k}>
                                <line
                                  x1={pad.left}
                                  y1={y}
                                  x2={pad.left + innerW}
                                  y2={y}
                                  stroke="var(--border-2)"
                                  strokeWidth={1}
                                />
                                <text
                                  x={8}
                                  y={y + 4}
                                  fontSize={10}
                                  fill="var(--text-3)"
                                  fontFamily="var(--font-mono), monospace"
                                >
                                  {fmtAxis(val)}
                                </text>
                              </g>
                            );
                          })}
                          <line
                            x1={pad.left}
                            y1={getY(0)}
                            x2={pad.left + innerW}
                            y2={getY(0)}
                            stroke="var(--border)"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                          />
                          {chartData.map((d, i) => {
                            const y0 = getY(0);
                            const yi = getY(d.income);
                            const ye = getY(d.expenses);
                            return (
                              <g key={`b-${i}`}>
                                <rect
                                  x={cx(i) - barW - 2}
                                  y={Math.min(y0, yi)}
                                  width={barW}
                                  height={Math.max(0, Math.abs(y0 - yi))}
                                  fill="rgb(36, 94, 176)"
                                  fillOpacity={xeroAccBarHover === `inc-${i}` ? 1 : 0.8}
                                  rx={3}
                                  style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                                  onMouseEnter={() => {
                                    setXeroChartHoverIdx(i);
                                    setXeroAccBarHover(`inc-${i}`);
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchTransactions(null, "Income", d.from, d.to);
                                  }}
                                />
                                <rect
                                  x={cx(i) + 2}
                                  y={Math.min(y0, ye)}
                                  width={barW}
                                  height={Math.max(0, Math.abs(y0 - ye))}
                                  fill="#ef4444"
                                  fillOpacity={xeroAccBarHover === `exp-${i}` ? 1 : 0.8}
                                  rx={3}
                                  style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                                  onMouseEnter={() => {
                                    setXeroChartHoverIdx(i);
                                    setXeroAccBarHover(`exp-${i}`);
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchTransactions(null, "Operating Expenses", d.from, d.to);
                                  }}
                                />
                              </g>
                            );
                          })}
                          {profitPathD ? (
                            <path
                              d={profitPathD}
                              fill="none"
                              stroke="#16a34a"
                              strokeWidth={2.5}
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          ) : null}
                          {chartData.map((d, i) => (
                            <circle
                              key={`c-${i}`}
                              cx={cx(i)}
                              cy={getY(d.profit)}
                              r={5}
                              fill={d.profit >= 0 ? "#16a34a" : "#dc2626"}
                              stroke="#fff"
                              strokeWidth={1.5}
                              style={{ cursor: "pointer" }}
                              onMouseEnter={() => setXeroChartHoverIdx(i)}
                            />
                          ))}
                          {chartData.map((d, i) => (
                            <text
                              key={`t-${i}`}
                              x={cx(i)}
                              y={chartHeight - 12}
                              textAnchor="middle"
                              fontSize={10}
                              fill="var(--text-3)"
                              fontFamily="var(--font-mono), monospace"
                            >
                              {d.month}
                            </text>
                          ))}
                        </svg>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 20,
                            marginTop: 14,
                            fontSize: 11,
                            color: "var(--text-2)",
                            alignItems: "center",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: "rgb(36, 94, 176)", opacity: 0.8 }} />
                            Revenue
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: "#ef4444", opacity: 0.8 }} />
                            Expenses
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 14, height: 3, borderRadius: 2, background: "#16a34a" }} />
                            Net profit
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--text-3)",
                            fontFamily: "var(--font-mono)",
                            textAlign: "center",
                            marginTop: 4,
                            textTransform: "uppercase",
                            letterSpacing: "1px",
                          }}
                        >
                          Click any bar to view transactions
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                        gap: isMobile ? 14 : 20,
                        marginBottom: 20,
                        alignItems: "stretch",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        {xeroLoading ? (
                          <div
                            style={{
                              padding: 40,
                              textAlign: "center",
                              color: "var(--text-3)",
                              fontSize: 12,
                            }}
                          >
                            Loading...
                          </div>
                        ) : revenuePieData.length > 0 ? (
                          <PieChart
                            data={revenuePieData}
                            title="Revenue by Source"
                            colors={PIE_COLORS_REVENUE}
                            compact={isMobile}
                            onSliceClick={(s) =>
                              fetchTransactions(
                                null,
                                s.label,
                                xeroData?.breakdownPeriod?.fromDate || xeroData?.summary?.fromDate,
                                xeroData?.breakdownPeriod?.toDate || xeroData?.summary?.toDate
                              )
                            }
                          />
                        ) : (
                          <div
                            style={{
                              padding: 40,
                              textAlign: "center",
                              color: "var(--text-3)",
                              fontSize: 12,
                            }}
                          >
                            No revenue data for this period
                          </div>
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        {xeroLoading ? (
                          <div
                            style={{
                              padding: 40,
                              textAlign: "center",
                              color: "var(--text-3)",
                              fontSize: 12,
                            }}
                          >
                            Loading...
                          </div>
                        ) : expensePieData.length > 0 ? (
                          <PieChart
                            data={expensePieData}
                            title="Expenses by Category"
                            colors={PIE_COLORS_EXPENSE}
                            compact={isMobile}
                            onSliceClick={(s) =>
                              fetchTransactions(
                                null,
                                s.label,
                                xeroData?.breakdownPeriod?.fromDate || xeroData?.summary?.fromDate,
                                xeroData?.breakdownPeriod?.toDate || xeroData?.summary?.toDate
                              )
                            }
                          />
                        ) : (
                          <div
                            style={{
                              padding: 40,
                              textAlign: "center",
                              color: "var(--text-3)",
                              fontSize: 12,
                            }}
                          >
                            No expense data for this period
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                        marginBottom: 20,
                        alignItems: "start",
                      }}
                    >
                      <div className="card" style={{ margin: 0 }}>
                        <div className="card-hdr">
                          <div className="card-title">Revenue Breakdown</div>
                          <div className="card-sub">Financial year to date</div>
                        </div>
                        <div style={{ padding: "12px 18px 18px", maxHeight: 360, overflowY: "auto" }}>
                          {fyPl.incomeLineItems.length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--text-3)" }}>No income lines in P&amp;L.</div>
                          ) : (
                            fyPl.incomeLineItems.map((row, idx) => {
                              const raw = parseFloat(String(row.amount).replace(/[^0-9.-]/g, "")) || 0;
                              const pct = Math.min(100, (raw / incTotal) * 100);
                              return (
                                <div key={`rev-${idx}-${row.name}`} style={{ marginBottom: 12 }}>
                                  <div className="acc-breakdown-row" style={{ border: "none", padding: "0 0 4px" }}>
                                    <span style={{ fontSize: 12, color: "var(--text)" }}>{row.name}</span>
                                    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                                      {formatPlCurrency(row.amount)}
                                    </span>
                                  </div>
                                  <div style={{ height: 4, borderRadius: 10, background: "var(--surface)", overflow: "hidden" }}>
                                    <div
                                      className="acc-breakdown-bar"
                                      style={{ width: `${pct}%`, background: "var(--teal)", height: "100%" }}
                                    />
                                  </div>
                                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{pct.toFixed(0)}% of FY revenue</div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <div className="card" style={{ margin: 0 }}>
                        <div className="card-hdr">
                          <div className="card-title">Expense Breakdown</div>
                          <div className="card-sub">Financial year to date · sorted by amount</div>
                        </div>
                        <div style={{ padding: "12px 18px 18px", maxHeight: 360, overflowY: "auto" }}>
                          {expSorted.length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--text-3)" }}>No expense lines in P&amp;L.</div>
                          ) : (
                            expSorted.map((row, idx) => {
                              const raw = parseFloat(String(row.amount).replace(/[^0-9.-]/g, "")) || 0;
                              const pct = Math.min(100, (raw / expTotal) * 100);
                              return (
                                <div key={`ex-${idx}-${row.name}`} style={{ marginBottom: 12 }}>
                                  <div className="acc-breakdown-row" style={{ border: "none", padding: "0 0 4px" }}>
                                    <span style={{ fontSize: 12, color: "var(--text)" }}>{row.name}</span>
                                    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                                      {formatPlCurrency(row.amount)}
                                    </span>
                                  </div>
                                  <div style={{ height: 4, borderRadius: 10, background: "var(--surface)", overflow: "hidden" }}>
                                    <div
                                      className="acc-breakdown-bar"
                                      style={{ width: `${pct}%`, background: "#ea580c", height: "100%" }}
                                    />
                                  </div>
                                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{pct.toFixed(0)}% of FY expenses</div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="acc-ai-report">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 16,
                          flexWrap: "wrap",
                          gap: 12,
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gold)", marginBottom: 6, letterSpacing: "2px" }}>
                            ✦ AI Financial Analysis
                          </div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Powered by your live Xero P&amp;L</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: 9,
                              fontFamily: "var(--font-mono)",
                              color: "rgba(255,255,255,0.35)",
                              padding: "4px 8px",
                              border: "1px solid rgba(255,255,255,0.12)",
                              borderRadius: 6,
                            }}
                          >
                            Generated by Claude
                          </span>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{
                              fontSize: 11,
                              color: "white",
                              borderColor: "rgba(255,255,255,0.25)",
                            }}
                            onClick={() => generateXeroAIReport()}
                          >
                            ↺ Regenerate
                          </button>
                        </div>
                      </div>
                      {xeroAIReportLoading ? (
                        <div style={{ padding: "24px 0", position: "relative", zIndex: 1 }}>
                          <div className="ai-typing" style={{ justifyContent: "flex-start" }}>
                            <div className="typing-dot" />
                            <div className="typing-dot" />
                            <div className="typing-dot" />
                          </div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 10 }}>Analysing your numbers…</div>
                        </div>
                      ) : (
                        <div
                          style={{
                            color: "rgba(255,255,255,0.9)",
                            fontSize: 13,
                            lineHeight: 1.8,
                            whiteSpace: "pre-wrap",
                            position: "relative",
                            zIndex: 1,
                          }}
                        >
                          {xeroAIReport || "Your financial narrative will appear here after data loads."}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ══════════════════════════════════════════════
              INSIGHTS
          ══════════════════════════════════════════════ */}
          {page === "insights" && (() => {
            const totalMatters = MATTERS.length;
            const settledMatters = MATTERS.filter((m) => m.stage === "Settled");
            const activeMatters = MATTERS.filter((m) => m.status === "active");
            const settlementRate = totalMatters ? Math.round((settledMatters.length / totalMatters) * 100) : 0;
            const daysToSettleArr = MATTERS.filter((m) => (m.settlement_date || m.settlement) && (m.opened_date || m.opened)).map((m) => {
              const open = new Date(m.opened_date || m.opened || 0).getTime();
              const settle = new Date(m.settlement_date || m.settlement || 0).getTime();
              return Math.round((settle - open) / (1000 * 60 * 60 * 24));
            }).filter((d) => d > 0);
            const avgDaysToSettle = daysToSettleArr.length ? Math.round(daysToSettleArr.reduce((a, b) => a + b, 0) / daysToSettleArr.length) : "—";
            const pipelineValue = activeMatters.reduce((sum, m) => sum + (parseFloat(String(m.price || 0).replace(/[^0-9.]/g, "")) || 0), 0);
            const pipelineStr = pipelineValue >= 1e6 ? "$" + (pipelineValue / 1e6).toFixed(1) + "M" : pipelineValue >= 1e3 ? "$" + (pipelineValue / 1e3).toFixed(0) + "K" : "$" + pipelineValue;

            const INSIGHTS_STAGES = ["Intake", "Contract Review", "Contract Sent", "Searches Ordered", "PEXA Ready", "Settled"];
            const stageCounts = INSIGHTS_STAGES.map((s) => ({ key: s, count: MATTERS.filter((m) => (m.stage || "").trim() === s).length }));
            const stageTotal = stageCounts.reduce((a, b) => a + b.count, 0) || 1;

            const monthCounts = (() => {
              const now = new Date();
              const out = [];
              for (let i = 8; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const y = d.getFullYear(), m = d.getMonth();
                const count = MATTERS.filter((mat) => {
                  const o = mat.opened_date || mat.opened;
                  if (!o) return false;
                  const od = new Date(o);
                  return od.getFullYear() === y && od.getMonth() === m;
                }).length;
                out.push({ label: d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" }), count });
              }
              return out;
            })();
            const monthMax = Math.max(1, ...monthCounts.map((x) => x.count));

            const typeOrder = ["Purchase", "Sale", "Lease", "Contract Review", "General Enquiry"];
            const typeCounts = typeOrder.map((t) => ({ name: t, count: MATTERS.filter((m) => (m.type || "").trim() === t).length }));
            const otherCount = MATTERS.filter((m) => !typeOrder.includes((m.type || "").trim())).length;
            if (otherCount > 0) typeCounts.push({ name: "Other", count: otherCount });
            const typeTotal = typeCounts.reduce((a, b) => a + b.count, 0) || 1;

            const nswCount = MATTERS.filter((m) => m.state === "NSW").length;
            const vicCount = MATTERS.filter((m) => m.state === "VIC").length;
            const stateTotal = nswCount + vicCount || 1;

            const sourceOrder = ["Website", "Referral", "Email", "Walk-in", "Other"];
            const sourceCountsMap = sourceOrder.map((s) => ({ name: s, count: MATTERS.filter((m) => (m.source || "Other") === s).length }));
            const sourceTotal = sourceCountsMap.reduce((a, b) => a + b.count, 0) || 1;

            return (
              <div
                className="content"
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  padding: 0,
                }}
              >
              <div
                style={{
                  display: "flex",
                  flexDirection: isMobile ? "column" : "row",
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: isMobile ? "14px 16px" : "20px 24px",
                    minWidth: 0,
                  }}
                >
                  {/* Section 1 - Firm Performance Stats */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, 1fr)",
                      gap: 12,
                      marginBottom: 24,
                    }}
                  >
                    {[
                      { label: "Total Matters YTD", value: totalMatters, sub: "matters" },
                      { label: "Settlement Rate", value: settlementRate + "%", sub: "closed" },
                      { label: "Avg Days to Settle", value: avgDaysToSettle, sub: "days" },
                      { label: "Pipeline Value", value: pipelineStr, sub: "active" },
                      { label: "Active Matters", value: activeMatters.length, sub: "in progress" }
                    ].map((s) => (
                      <div key={s.label} className="card" style={{ padding: 16 }}>
                        <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)", marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--text)" }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{s.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Section 2 - Two column */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: 16,
                      marginBottom: 24,
                    }}
                  >
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">Matter Pipeline Analysis</div></div>
                      <div style={{ padding: "12px 16px 16px" }}>
                        {stageCounts.map(({ key, count }) => (
                          <div key={key} style={{ marginBottom: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: "var(--text-2)" }}>{key}</span>
                              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{count} ({Math.round((count / stageTotal) * 100)}%)</span>
                            </div>
                            <div style={{ height: 8, background: "var(--surface)", borderRadius: 8, overflow: "hidden" }}>
                              <div style={{ width: `${(count / stageTotal) * 100}%`, height: "100%", background: STAGE_COLORS[key] || "#94a3b8", borderRadius: 8 }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">Monthly Activity</div></div>
                      <div style={{ padding: "8px 16px 14px" }}>
                        <div className="chart-wrap">
                          {monthCounts.map((d, i) => (
                            <div key={d.label} className="chart-bar" style={{ height: `${(d.count / monthMax) * 100}%`, background: i === monthCounts.length - 1 ? "linear-gradient(to top,#245eb0,rgba(36,94,176,0.3))" : "linear-gradient(to top,var(--teal),rgba(26,74,158,0.2))" }}>
                              <div className="chart-bar-label">{d.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 3 - Three column */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                      gap: 16,
                      marginBottom: 24,
                    }}
                  >
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">Matter Type Mix</div></div>
                      <div style={{ padding: "12px 16px 16px" }}>
                        {typeCounts.filter((t) => t.count > 0).map((t) => (
                          <div key={t.name} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.name === "Purchase" ? "var(--teal)" : t.name === "Sale" ? "var(--amber)" : t.name === "Lease" ? "var(--purple)" : "var(--text-3)" }} />
                              <span style={{ fontSize: 11, color: "var(--text-2)", flex: 1 }}>{t.name}</span>
                              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{t.count} ({Math.round((t.count / typeTotal) * 100)}%)</span>
                            </div>
                            <div style={{ height: 5, background: "var(--surface)", borderRadius: 10, overflow: "hidden" }}>
                              <div style={{ width: `${(t.count / typeTotal) * 100}%`, height: "100%", background: t.name === "Purchase" ? "var(--teal)" : t.name === "Sale" ? "var(--amber)" : t.name === "Lease" ? "var(--purple)" : "var(--text-3)", borderRadius: 10, opacity: 0.8 }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">NSW vs VIC</div></div>
                      <div style={{ padding: "12px 16px 16px" }}>
                        <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
                          <div>
                            <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 600, color: "var(--blue)" }}>{nswCount}</div>
                            <div style={{ fontSize: 10, color: "var(--text-3)" }}>NSW</div>
                          </div>
                          <div>
                            <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 600, color: "var(--purple)" }}>{vicCount}</div>
                            <div style={{ fontSize: 10, color: "var(--text-3)" }}>VIC</div>
                          </div>
                        </div>
                        <div style={{ height: 8, background: "var(--surface)", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                          <div style={{ width: `${(nswCount / stateTotal) * 100}%`, background: "var(--blue)", borderRadius: 8 }} />
                          <div style={{ width: `${(vicCount / stateTotal) * 100}%`, background: "var(--purple)", borderRadius: 8 }} />
                        </div>
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">How Clients Find Us</div></div>
                      <div style={{ padding: "12px 16px 16px" }}>
                        {sourceCountsMap.filter((s) => s.count > 0).map((s) => (
                          <div key={s.name} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                              <span style={{ color: "var(--text-2)" }}>{s.name}</span>
                              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{s.count}</span>
                            </div>
                            <div style={{ height: 5, background: "var(--surface)", borderRadius: 10, overflow: "hidden" }}>
                              <div style={{ width: `${(s.count / sourceTotal) * 100}%`, height: "100%", background: "var(--teal)", borderRadius: 10, opacity: 0.7 }} />
                            </div>
                          </div>
                        ))}
                        {sourceCountsMap.every((s) => s.count === 0) && <div style={{ fontSize: 11, color: "var(--text-3)" }}>No source data</div>}
                      </div>
                    </div>
                  </div>

                  {/* Section 4 - Market Intelligence */}
                  <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-hdr">
                      <div className="card-title">Market Intelligence — Your Practice Areas</div>
                      <div className="card-sub">Insights from internet sources — property market & conveyancing fees</div>
                    </div>
                    <div style={{ padding: "16px 20px" }}>
                      {marketLoading ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 20 }}>
                          <div className="ai-typing"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>Fetching market data...</span>
                        </div>
                      ) : marketData?.suburbs?.length > 0 ? (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
                            {marketData.suburbs.map((sub, i) => (
                              <div key={i} className="card" style={{ padding: 12, border: "1px solid var(--border-2)" }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{sub.name}</div>
                                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-2)", marginBottom: 2 }}>{sub.medianPrice || "—"}</div>
                                {sub.trend && <span style={{ fontSize: 9, color: "var(--green)", fontFamily: "var(--font-mono)" }}>{sub.trend}</span>}
                                {sub.daysOnMarket != null && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{sub.daysOnMarket} days on market</div>}
                                {sub.commentary && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6, lineHeight: 1.4 }}>{sub.commentary}</div>}
                              </div>
                            ))}
                          </div>
                          {marketData.marketOverview && (
                            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 16 }}>
                              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>Market Overview</div>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                                  gap: 12,
                                  fontSize: 11,
                                  lineHeight: 1.6,
                                  color: "var(--text-2)",
                                }}
                              >
                                {marketData.marketOverview.sydney && <div><strong>Sydney:</strong> {(marketData.marketOverview.sydney || "").slice(0, 200)}</div>}
                                {marketData.marketOverview.melbourne && <div><strong>Melbourne:</strong> {(marketData.marketOverview.melbourne || "").slice(0, 200)}</div>}
                              </div>
                              {(marketData.marketOverview.interestRates || marketData.marketOverview.outlook) && (
                                <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>{marketData.marketOverview.interestRates} {marketData.marketOverview.outlook}</div>
                              )}
                            </div>
                          )}
                          {marketData?.conveyancingFees && (
                            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 16, marginTop: 16 }}>
                              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>Average conveyancing fees (market)</div>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                                  gap: 12,
                                  fontSize: 11,
                                  lineHeight: 1.5,
                                  color: "var(--text-2)",
                                }}
                              >
                                {marketData.conveyancingFees.nsw && (
                                  <div>
                                    <strong>NSW</strong>
                                    <div style={{ marginTop: 4 }}>{(marketData.conveyancingFees.nsw.average || marketData.conveyancingFees.nsw.range || "—").toString()}</div>
                                    {(marketData.conveyancingFees.nsw.purchase || marketData.conveyancingFees.nsw.sale) && (
                                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
                                        {marketData.conveyancingFees.nsw.purchase && <div>Purchase: {String(marketData.conveyancingFees.nsw.purchase)}</div>}
                                        {marketData.conveyancingFees.nsw.sale && <div>Sale: {String(marketData.conveyancingFees.nsw.sale)}</div>}
                                      </div>
                                    )}
                                    {marketData.conveyancingFees.nsw.source && <div style={{ fontSize: 9, color: "var(--text-3)", marginTop: 4 }}>{String(marketData.conveyancingFees.nsw.source)}</div>}
                                  </div>
                                )}
                                {marketData.conveyancingFees.vic && (
                                  <div>
                                    <strong>VIC</strong>
                                    <div style={{ marginTop: 4 }}>{(marketData.conveyancingFees.vic.average || marketData.conveyancingFees.vic.range || "—").toString()}</div>
                                    {(marketData.conveyancingFees.vic.purchase || marketData.conveyancingFees.vic.sale) && (
                                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
                                        {marketData.conveyancingFees.vic.purchase && <div>Purchase: {String(marketData.conveyancingFees.vic.purchase)}</div>}
                                        {marketData.conveyancingFees.vic.sale && <div>Sale: {String(marketData.conveyancingFees.vic.sale)}</div>}
                                      </div>
                                    )}
                                    {marketData.conveyancingFees.vic.source && <div style={{ fontSize: 9, color: "var(--text-3)", marginTop: 4 }}>{String(marketData.conveyancingFees.vic.source)}</div>}
                                  </div>
                                )}
                              </div>
                              {marketData.conveyancingFees.commentary && (
                                <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>{String(marketData.conveyancingFees.commentary)}</div>
                              )}
                            </div>
                          )}
                        </>
                      ) : marketData?.raw ? (
                        <div style={{ fontSize: 11, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{marketData.raw}</div>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-3)", padding: 12 }}>No market data available. Add matters with addresses to fetch suburb intelligence.</div>
                      )}
                    </div>
                  </div>

                  {/* Section 5 - AI Intelligence Report */}
                  <div className="card">
                    <div className="card-hdr"><div className="card-title">AI Intelligence Report</div></div>
                    <div style={{ padding: "16px 20px" }}>
                      {insightsAutoLoading ? (
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Generating report... <div className="ai-typing" style={{ marginTop: 6 }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div></div>
                      ) : insightsAutoSummary ? (
                        <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{insightsAutoSummary}</div>
                      ) : insightsAutoError ? (
                        <>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10 }}>{insightsAutoError}</div>
                          <button type="button" className="btn-gold" style={{ fontSize: 12 }} onClick={() => generateInsightsSummary()}>Retry report</button>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>Report will generate when you open this page.</div>
                          <button type="button" className="btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={() => generateInsightsSummary()}>Generate report</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right panel - Insights Intelligence */}
                <div
                  style={{
                    width: isMobile ? "100%" : 340,
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    background: "var(--ink)",
                    borderLeft: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
                    borderTop: isMobile ? "1px solid rgba(255,255,255,0.06)" : "none",
                    minHeight: isMobile ? 280 : undefined,
                    maxHeight: isMobile ? "min(55dvh, 420px)" : undefined,
                  }}
                >
                  <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                    <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "2px", marginBottom: 6 }}>✦ Insights Intelligence</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color: "white" }}>Practice AI</div>
                  </div>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, maxHeight: 200, overflowY: "auto" }}>
                    {insightsAutoLoading ? (
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Analysing practice data...<div className="ai-typing" style={{ marginTop: 6 }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div></div>
                    ) : insightsAutoSummary ? (
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{insightsAutoSummary}</div>
                    ) : null}
                  </div>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {["How is my practice performing?", "Most profitable matter type?", "Market trends for my suburbs?", "Where are clients coming from?"].map((q) => (
                      <button key={q} type="button" style={{ fontSize: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "4px 8px", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 0.12s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }} onClick={() => sendInsightsAI(q)}>{q}</button>
                    ))}
                  </div>
                  <div style={{ flex: 1, overflowY: "scroll", minHeight: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {insightsAIChat.length === 0 && (
                      <div style={{ textAlign: "center", padding: "30px 10px", color: "rgba(255,255,255,0.2)", fontSize: 11, lineHeight: 1.7 }}>
                        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>✦</div>
                        Ask me anything about your practice performance, market trends or growth opportunities.
                      </div>
                    )}
                    {insightsAIChat.map((m, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 7, alignItems: "flex-start" }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: m.role === "user" ? "linear-gradient(135deg,var(--blue),#1a4a9e)" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.1)" }}>{m.role === "user" ? "G" : "✦"}</div>
                        <div style={{ maxWidth: "84%", padding: "8px 12px", borderRadius: m.role === "user" ? "10px 3px 10px 10px" : "3px 10px 10px 10px", fontSize: 11, lineHeight: 1.75, background: m.role === "user" ? "rgba(36,94,176,0.3)" : "rgba(255,255,255,0.06)", color: m.role === "user" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.7)", border: m.role === "user" ? "1px solid rgba(36,94,176,0.4)" : "1px solid rgba(255,255,255,0.08)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>
                      </div>
                    ))}
                    {insightsAITyping && (
                      <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>✦</div>
                        <div style={{ padding: "9px 12px", borderRadius: "3px 10px 10px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <div className="ai-typing"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", gap: 6 }}>
                    <input style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "rgba(255,255,255,0.8)", outline: "none", fontFamily: "var(--font-body)" }} placeholder="Ask about your practice..." value={insightsAIChatInput} onChange={(e) => setInsightsAIChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendInsightsAI()} onFocus={(e) => { e.target.style.borderColor = "rgba(36,94,176,0.5)"; e.target.style.background = "rgba(255,255,255,0.09)"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; e.target.style.background = "rgba(255,255,255,0.06)"; }} />
                    <button type="button" style={{ background: "linear-gradient(135deg,var(--blue),#1a4a9e)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", flexShrink: 0 }} onClick={() => sendInsightsAI()}>›</button>
                  </div>
                </div>
              </div>
              </div>
            );
          })()}

          {/* Catch-all */}
          {!["dashboard","matters","matter_workspace","referrals","contacts","calendar","communications","accounting","insights"].includes(page) && (
            <div className="under-construction">
              <div style={{textAlign:"center",color:"var(--text-3)"}}>
                <div style={{fontFamily:"var(--font-display)",fontSize:48,opacity:0.15,marginBottom:12}}>⚖</div>
                <div style={{fontFamily:"var(--font-display)",fontSize:20,color:"var(--text)",marginBottom:6}}>{pageTitle[page]||page}</div>
                <div style={{fontSize:12}}>This section is coming soon.</div>
              </div>
            </div>
          )}

        </div>{/* /main */}

        {isMobile && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, minHeight: 56, paddingTop: 6, background: "var(--ink)", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
            <div className="mobile-tab-bar" role="tablist" aria-label="Main navigation">
            {[
              { id: "dashboard", icon: "⊞", label: "Home" },
              { id: "matters", icon: "⚖️", label: "Matters" },
              { id: "contacts", icon: "👥", label: "Contacts" },
              { id: "calendar", icon: "📅", label: "Calendar" },
              { id: "communications", icon: "✉️", label: "Emails" },
              { id: "accounting", icon: "💰", label: "Accounts" },
              { id: "insights", icon: "✦", label: "Insights" },
            ].map((n) => {
              const active =
                page === n.id || (n.id === "matters" && page === "matter_workspace");
              return (
              <button
                key={n.id}
                type="button"
                role="tab"
                aria-selected={active}
                className="mobile-tab-btn"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer", padding: "6px 10px", flex: "0 0 auto", minWidth: 52, opacity: active ? 1 : 0.45, transition: "opacity 0.15s", WebkitTapHighlightColor: "transparent" }}
                onClick={() => { setPage(n.id); if (n.id !== "matters") setSelectedMatter(null); }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{n.icon}</span>
                <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "white", textTransform: "uppercase", letterSpacing: "0.3px", textAlign: "center", lineHeight: 1.15, maxWidth: 64, whiteSpace: "normal", wordBreak: "break-word" }}>{n.label}</span>
              </button>
              );
            })}
            </div>
          </div>
        )}
      </div>{/* /app */}

      {/* Xero transaction drill-down */}
      {txModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(13,15,26,0.6)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setTxModal(false)}
        >
          <div
            style={{
              background: "var(--white)",
              borderRadius: 16,
              width: 720,
              maxWidth: "92vw",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "var(--shadow-xl)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 500, color: "var(--text)" }}>
                {txAccountName || "Transactions"}
                {txData?.fromDate && txData?.toDate ? (
                  <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-2)", marginLeft: 8 }}>
                    {txData.fromDate} → {txData.toDate}
                  </span>
                ) : null}
              </div>
              <button type="button" className="modal-close" onClick={() => setTxModal(false)}>
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {txLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>Loading transactions…</div>
              ) : txData?.error ? (
                <div style={{ fontSize: 13, color: "var(--red)" }}>{txData.error}</div>
              ) : !txData?.transactions?.length ? (
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>
                  {txData?.message || "No matching transactions in this range."}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--text-3)",
                        fontFamily: "var(--font-mono), monospace",
                      }}
                    >
                      <th style={{ padding: "8px 6px" }}>Date</th>
                      <th style={{ padding: "8px 6px" }}>Account</th>
                      <th style={{ padding: "8px 6px" }}>Description</th>
                      <th style={{ padding: "8px 6px", textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txData.transactions.map((r, idx) => (
                      <tr
                        key={`${r.reference}-${idx}-${r.accountName || r.accountCode}`}
                        style={{ borderBottom: "1px solid var(--border-2)" }}
                      >
                        <td style={{ padding: "8px 6px", fontFamily: "var(--font-mono), monospace", color: "var(--text-2)" }}>
                          {r.date}
                        </td>
                        <td style={{ padding: "8px 6px" }}>{r.accountName || r.accountCode || "—"}</td>
                        <td style={{ padding: "8px 6px", color: "var(--text-2)" }}>{r.description || "—"}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--font-mono), monospace" }}>
                          {formatPlCurrency(r.netAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!txLoading && txData?.transactions?.length > 0 && txData?.total != null ? (
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 12, fontFamily: "var(--font-mono), monospace" }}>
                  Total: {formatPlCurrency(txData.total)}
                </div>
              ) : null}
            </div>
            {txData?.note && (
              <div
                style={{
                  padding: "8px 24px",
                  background: "var(--gold-light)",
                  borderTop: "1px solid var(--gold-dim)",
                  fontSize: 11,
                  color: "var(--text-3)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                ℹ️ {txData.note}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compose email modal */}
      {composeModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(13,15,26,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setComposeModal(false)}>
          <div style={{background:"var(--white)",borderRadius:16,width:680,maxWidth:"90vw",maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"var(--shadow-xl)"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"var(--font-display)",fontSize:18,fontWeight:500,color:"var(--text)"}}>{composeModalMode==="reply"?"Reply":composeModalMode==="forward"?"Forward":"New Email"}</div>
              <button type="button" className="modal-close" onClick={()=>setComposeModal(false)}>✕</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:20}}>
              <div style={{marginBottom:12}}>
                <label style={{fontSize:10,color:"var(--text-3)",display:"block",marginBottom:4}}>To</label>
                <input className="intake-input" placeholder="client@example.com" value={composeTo} onChange={e=>setComposeTo(e.target.value)} style={{width:"100%"}}/>
              </div>
              <div style={{marginBottom:12}}>
                <label style={{fontSize:10,color:"var(--text-3)",display:"block",marginBottom:4}}>Subject</label>
                <input className="intake-input" placeholder="Subject" value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} style={{width:"100%"}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:"var(--text-3)",display:"block",marginBottom:4}}>Body</label>
                <textarea ref={composeBodyRef} placeholder="Type your message..." value={composeBody} onChange={e=>setComposeBody(e.target.value)} style={{width:"100%",height:300,resize:"vertical",fontFamily:"var(--font-body)",fontSize:13,lineHeight:1.7,padding:12,border:"1px solid var(--border)",borderRadius:8,outline:"none",color:"var(--text)",background:"var(--surface)"}}/>
                <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)",marginTop:4}}>{composeBody.length} chars</div>
                <div style={{fontSize:11,color:"var(--text-3)",marginTop:6}}>Your signature will be added automatically.</div>
              </div>
            </div>
            <div style={{padding:"12px 20px",borderTop:"1px solid var(--border)",display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
              <button type="button" className="btn-ghost" style={{fontSize:12}} onClick={requestEmailDraft} disabled={aiDraftLoading}>{aiDraftLoading?"Drafting...":"✦ AI Draft"}</button>
              <div style={{display:"flex",gap:8}}>
                <button type="button" className="btn-ghost" style={{fontSize:12}} onClick={()=>setComposeModal(false)}>Discard</button>
                <button type="button" className="btn-primary" style={{fontSize:12}} disabled={sendingEmail||!composeTo.trim()||!composeSubject.trim()} onClick={sendMatterEmail}>{sendingEmail?"Sending…":"Send ✉️"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact modal */}
      {contactModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(13,15,26,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{ setContactModal(false); setEditingContact(null); }}>
          <div style={{background:"var(--white)",borderRadius:16,width:560,maxWidth:"90vw",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"var(--shadow-xl)"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"var(--font-display)",fontSize:18,fontWeight:500,color:"var(--text)"}}>{editingContact ? "Edit Contact" : "Add Contact"}</div>
              <button type="button" className="modal-close" onClick={()=>{ setContactModal(false); setEditingContact(null); }}>✕</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:20}}>
              <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:12}}>
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Name *</label><input className="intake-input" value={contactForm.name} onChange={e=>setContactForm(f=>({...f,name:e.target.value}))} placeholder="Full name" style={{width:"100%"}}/></div>
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Type</label><select className="intake-input" value={contactForm.type} onChange={e=>setContactForm(f=>({...f,type:e.target.value}))} style={{width:"100%"}}><option value="Client">Client</option><option value="Real Estate Agent">Real Estate Agent</option><option value="Broker">Broker</option><option value="Accountant">Accountant</option><option value="Other">Other</option></select></div>
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Email</label><input className="intake-input" type="email" value={contactForm.email} onChange={e=>setContactForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={{width:"100%"}}/></div>
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Phone</label><input className="intake-input" value={contactForm.phone} onChange={e=>setContactForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" style={{width:"100%"}}/></div>
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Address</label><input className="intake-input" value={contactForm.address} onChange={e=>setContactForm(f=>({...f,address:e.target.value}))} placeholder="Address" style={{width:"100%"}}/></div>
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Company</label><input className="intake-input" value={contactForm.company} onChange={e=>setContactForm(f=>({...f,company:e.target.value}))} placeholder="Company" style={{width:"100%"}}/></div>
                <div style={{display:"flex",alignItems:"center",gap:8}}><input type="checkbox" id="contact-is-referrer" checked={contactForm.is_referrer} onChange={e=>setContactForm(f=>({...f,is_referrer:e.target.checked}))}/><label htmlFor="contact-is-referrer" className="contact-field-label" style={{marginBottom:0}}>Is Referrer</label></div>
                {contactForm.is_referrer && (<><div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Referrer Fee</label><input className="intake-input" value={contactForm.referrer_fee} onChange={e=>setContactForm(f=>({...f,referrer_fee:e.target.value}))} placeholder="e.g. $300" style={{width:"100%"}}/></div><div style={{display:"flex",alignItems:"center",gap:8}}><input type="checkbox" id="contact-formal" checked={contactForm.formal_agreement} onChange={e=>setContactForm(f=>({...f,formal_agreement:e.target.checked}))}/><label htmlFor="contact-formal" className="contact-field-label" style={{marginBottom:0}}>Formal Agreement</label></div></>)}
                <div><label className="contact-field-label" style={{display:"block",marginBottom:4}}>Notes</label><textarea className="intake-textarea" value={contactForm.notes} onChange={e=>setContactForm(f=>({...f,notes:e.target.value}))} placeholder="Notes" style={{minHeight:60}}/></div>
              </div>
            </div>
            <div style={{padding:"12px 20px",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"flex-end",gap:8}}>
              <button type="button" className="btn-ghost" onClick={()=>{ setContactModal(false); setEditingContact(null); }}>Cancel</button>
              <button type="button" className="btn-gold" disabled={!contactForm.name.trim()} onClick={async ()=>{ if(!contactForm.name.trim()) return; const payload = { name: contactForm.name.trim(), type: contactForm.type, email: contactForm.email.trim() || null, phone: contactForm.phone.trim() || null, address: contactForm.address.trim() || null, company: contactForm.company.trim() || null, is_referrer: contactForm.is_referrer, referrer_fee: contactForm.referrer_fee ? String(contactForm.referrer_fee).trim() : null, formal_agreement: contactForm.formal_agreement, notes: contactForm.notes.trim() || null }; if(editingContact){ const { error } = await supabase.from("contacts").update(payload).eq("id",editingContact.id); if(!error){ setContacts(prev=>prev.map(c=>c.id===editingContact.id?{...c,...payload}:c)); if(selectedContact?.id===editingContact.id) setSelectedContact({...editingContact,...payload}); } } else { const { data, error } = await supabase.from("contacts").insert(payload).select().single(); if(!error && data){ setContacts(prev=>[...prev,data]); setSelectedContact(data); } } setContactModal(false); setEditingContact(null); }}>{editingContact ? "Save" : "Add Contact"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {sendSuccessToast && (
        <div style={{position:"fixed",bottom:24,right:24,zIndex:1001,background:"var(--green)",color:"var(--white)",padding:"10px 16px",borderRadius:8,fontSize:13,fontWeight:500,boxShadow:"var(--shadow-lg)",animation:"toastFade 3s ease forwards"}}>Email sent ✓</div>
      )}

      {/* ══════════════════════════════════════════════
          NEW MATTER INTAKE MODAL
      ══════════════════════════════════════════════ */}
      {modal === "intake" && (
        <div className="modal-overlay" onClick={()=>{setModal(null);setIntakeStep(0);setIntakeSource(null);}}>
          <div className="intake-modal" onClick={e=>e.stopPropagation()}>
            <div className="intake-hdr">
              <div>
                <div className="intake-title">New Matter</div>
                <div className="intake-sub">AI will extract and populate fields automatically</div>
              </div>
              <button className="modal-close" onClick={()=>{setModal(null);setIntakeStep(0);setIntakeSource(null);}}>✕</button>
            </div>
            <div className="intake-stepper">
              {INTAKE_STEPS.map((s,i)=>(
                <div key={s} className="is-step" style={{flex:i<INTAKE_STEPS.length-1?1:"none"}}>
                  <div className={`is-dot ${i<intakeStep?"done":i===intakeStep?"curr":"todo"}`}>{i<intakeStep?"✓":i+1}</div>
                  <div className={`is-label ${i===intakeStep?"curr":""}`}>{s}</div>
                  {i<INTAKE_STEPS.length-1&&<div className={`is-line ${i<intakeStep?"done":""}`} style={{flex:1}}/>}
                </div>
              ))}
            </div>
            <div className="intake-body">
              {intakeStep===0&&(
                <>
                  <div style={{fontSize:12,color:"var(--text-2)",marginBottom:16}}>How is this matter coming in? Select the source and AI will extract key details.</div>
                  <div className="intake-source-grid">
                    {SOURCES.map(s=>(
                      <div key={s.id} className={`src-card ${intakeSource===s.id?"sel":""}`} onClick={()=>setIntakeSource(s.id)}>
                        <div className="src-icon">{s.icon}</div>
                        <div className="src-label">{s.label}</div>
                        <div className="src-desc">{s.desc}</div>
                      </div>
                    ))}
                  </div>
                  {intakeSource&&(
                    <>
                      <label className="intake-label">Paste content from {intakeSource}</label>
                      <textarea className="intake-textarea" placeholder="Paste email, message, or notes here... AI will extract the key details." value={intakeText} onChange={e=>setIntakeText(e.target.value)}/>
                    </>
                  )}
                </>
              )}
              {intakeStep===1&&(
                <div style={{textAlign:"center",padding:"32px 0"}}>
                  {intakeExtracting&&(
                    <>
                      <div style={{fontSize:40,marginBottom:16,display:"inline-block",animation:"bounce 1s ease infinite"}}>✦</div>
                      <div style={{fontFamily:"var(--font-display)",fontSize:18,color:"var(--text)",marginBottom:6}}>Analysing your {intakeSource}...</div>
                      <div style={{fontSize:12,color:"var(--text-3)",marginBottom:20}}>Extracting client details, property address, key dates, and special conditions.</div>
                    </>
                  )}
                </div>
              )}
              {intakeStep===2&&(
                <>
                  <div className="extracted-card">
                    <span className="ext-badge">✦ AI Extracted · 94% confidence</span>
                    {[{k:"Client Name",v:"New Client",c:"high"},{k:"Property",v:"[Extracted Address]",c:"high"},{k:"Price",v:"[Extracted Price]",c:"high"},{k:"Settlement",v:"[Extracted Date]",c:"high"},{k:"Lender",v:"[Extracted Lender]",c:"med"}].map(f=>(
                      <div key={f.k} className="ext-field">
                        <span className="ext-key">{f.k}</span>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span className="ext-val">{f.v}</span>
                          <span className={`ext-conf ${f.c==="high"?"conf-hi":"conf-med"}`}>{f.c==="high"?"✓ High":"~ Med"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--amber)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:8}}>⚠ Missing — please complete</div>
                    {["Phone number","Email address","Agent details","Referral source"].map(f=>(
                      <div key={f} className="missing-alert">⚠ {f} not detected</div>
                    ))}
                  </div>
                  <div style={{marginBottom:14}}>
                    <label className="intake-label">Address</label>
                    <input
                      ref={addressInputRef}
                      type="text"
                      className="intake-input"
                      placeholder="Start typing address..."
                      value={intakeAddress}
                      onChange={e=>setIntakeAddress(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="intake-grid">
                    {[["Phone",""],["Email",""],["Agent",""],["Source","Website"],["Type","Purchase"],["State",intakeState],["Suburb",intakeSuburb],["Postcode",intakePostcode]].map(([l,d])=>(
                      <div key={l}>
                        <label className="intake-label">{l}</label>
                        {l === "State" || l === "Suburb" || l === "Postcode" ? (
                          <input
                            className="intake-input"
                            placeholder={`Enter ${l.toLowerCase()}...`}
                            value={d}
                            onChange={e=>{ if(l==="State")setIntakeState(e.target.value); if(l==="Suburb")setIntakeSuburb(e.target.value); if(l==="Postcode")setIntakePostcode(e.target.value); }}
                          />
                        ) : (
                          <input className="intake-input" defaultValue={d} placeholder={`Enter ${l.toLowerCase()}...`}/>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {intakeStep===3&&(
                <div style={{textAlign:"center",padding:"24px 0"}}>
                  <div style={{fontSize:48,marginBottom:14}}>✅</div>
                  <div style={{fontFamily:"var(--font-display)",fontSize:20,color:"var(--text)",marginBottom:6}}>Matter Created</div>
                  <div style={{fontSize:12,color:"var(--text-3)",marginBottom:20}}>New matter has been created and added to your pipeline.</div>
                  <div style={{background:"var(--gold-light)",borderRadius:12,padding:"14px 20px",border:"1px solid var(--gold-dim)",textAlign:"left"}}>
                    {[["Matter ID","CC-2025-042"],["Client","New Client"],["Stage","Intake → Assigned to J. Chen"]].map(([k,v])=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--gold-dim)",fontSize:12,gap:8}}>
                        <span style={{color:"var(--text-3)"}}>{k}</span>
                        <span style={{fontWeight:600,color:"var(--text)"}}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="intake-footer">
              <button className="btn-ghost" onClick={()=>{setModal(null);setIntakeStep(0);setIntakeSource(null);}}>Cancel</button>
              <div style={{display:"flex",gap:8}}>
                {intakeStep>0&&intakeStep<3&&<button className="btn-ghost" onClick={()=>setIntakeStep(s=>s-1)}>← Back</button>}
                {intakeStep===0&&<button className="btn-gold" disabled={!intakeSource||!intakeText} onClick={()=>{setIntakeStep(1);runExtract();}}>Extract with AI →</button>}
                {intakeStep===2&&<button className="btn-gold" onClick={()=>setIntakeStep(3)}>Create Matter →</button>}
                {intakeStep===3&&<button className="btn-gold" onClick={()=>{setModal(null);setPage("matters");setIntakeStep(0);}}>Open Matters →</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tooltip && (
        <div style={{
          position:"fixed",
          left:Math.min(tooltip.x+12, typeof window!=="undefined"?window.innerWidth-280:tooltip.x+12),
          top:Math.min(tooltip.y+12, typeof window!=="undefined"?window.innerHeight-200:tooltip.y+12),
          zIndex:2000,
          background:"var(--ink)",
          color:"white",
          borderRadius:10,
          padding:"12px 16px",
          width:260,
          boxShadow:"var(--shadow-xl)",
          pointerEvents:"none",
          animation:"fadeUp 0.15s ease"
        }}>
          <div style={{
            display:"inline-flex",alignItems:"center",gap:6,
            background:"rgba(255,255,255,0.1)",
            borderRadius:20,padding:"2px 10px",
            fontSize:10,fontFamily:"var(--font-mono)",
            textTransform:"uppercase",letterSpacing:"1px",
            marginBottom:8,color:"rgba(255,255,255,0.7)"
          }}>
            <div style={{
              width:6,height:6,borderRadius:"50%",
              background:EVENT_COLORS[tooltip.event.event_type]?.dot||"#94a3b8"
            }}/>
            {tooltip.event.event_type}
          </div>
          <div style={{
            fontFamily:"var(--font-display)",
            fontSize:15,fontWeight:500,
            color:"white",marginBottom:8,
            lineHeight:1.3
          }}>
            {tooltip.event.title}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {tooltip.event.date&&(
              <div style={{display:"flex",gap:8,fontSize:11}}>
                <span style={{color:"rgba(255,255,255,0.4)",fontFamily:"var(--font-mono)",minWidth:60}}>DATE</span>
                <span style={{color:"rgba(255,255,255,0.85)"}}>
                  {new Date(tooltip.event.date+"T00:00:00").toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"long",year:"numeric"})}
                </span>
              </div>
            )}
            {tooltip.event.time&&(
              <div style={{display:"flex",gap:8,fontSize:11}}>
                <span style={{color:"rgba(255,255,255,0.4)",fontFamily:"var(--font-mono)",minWidth:60}}>TIME</span>
                <span style={{color:"rgba(255,255,255,0.85)"}}>{tooltip.event.time}</span>
              </div>
            )}
            {tooltip.event.client_name&&(
              <div style={{display:"flex",gap:8,fontSize:11}}>
                <span style={{color:"rgba(255,255,255,0.4)",fontFamily:"var(--font-mono)",minWidth:60}}>CLIENT</span>
                <span style={{color:"rgba(255,255,255,0.85)"}}>{tooltip.event.client_name}</span>
              </div>
            )}
            {tooltip.event.matter_ref&&(
              <div style={{display:"flex",gap:8,fontSize:11}}>
                <span style={{color:"rgba(255,255,255,0.4)",fontFamily:"var(--font-mono)",minWidth:60}}>MATTER</span>
                <span style={{color:"rgba(255,255,255,0.85)",fontFamily:"var(--font-mono)"}}>{tooltip.event.matter_ref}</span>
              </div>
            )}
            {tooltip.event.notes&&(
              <div style={{
                marginTop:6,paddingTop:6,
                borderTop:"1px solid rgba(255,255,255,0.1)",
                fontSize:10,color:"rgba(255,255,255,0.5)",
                lineHeight:1.6
              }}>
                {(tooltip.event.notes||"").slice(0,120)}{(tooltip.event.notes||"").length>120?"…":""}
              </div>
            )}
          </div>
          <div style={{
            marginTop:8,paddingTop:6,
            borderTop:"1px solid rgba(255,255,255,0.1)",
            fontSize:9,color:"rgba(255,255,255,0.3)",
            fontFamily:"var(--font-mono)",textTransform:"uppercase",
            letterSpacing:"1px"
          }}>Click to open event details</div>
        </div>
      )}
    </>
  );
}

