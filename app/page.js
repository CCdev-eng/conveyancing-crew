"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";

// ─── DATA ──────────────────────────────────────────────────────────────────────

const TASKS = [
  { id:1, matter:"CC-2025-034", client:"David & Karen Wu", task:"Follow up council + water searches", due:"Today", urgency:"critical", done:false },
  { id:2, matter:"CC-2025-039", client:"James Nguyen", task:"Create PEXA workspace — settlement 7 Apr", due:"Today", urgency:"critical", done:false },
  { id:3, matter:"CC-2025-041", client:"Sarah & Tom Mitchell", task:"Chase pool compliance cert from vendor", due:"Today", urgency:"high", done:false },
  { id:4, matter:"CC-2025-039", client:"James Nguyen", task:"Pay Mark Delaney referral fee — $300", due:"Today", urgency:"medium", done:false },
  { id:5, matter:"CC-2025-037", client:"Priya Sharma", task:"Send PEXA ready confirmation to client", due:"Tomorrow", urgency:"medium", done:false },
  { id:6, matter:"CC-2025-041", client:"Sarah & Tom Mitchell", task:"Order strata report if applicable", due:"15 Mar", urgency:"low", done:false },
  { id:7, matter:"CC-2025-034", client:"David & Karen Wu", task:"Review special conditions — pool cert", due:"15 Mar", urgency:"low", done:true },
];

const COMMS = [
  { id:1, from:"Sarah Mitchell", channel:"email", preview:"Hi, just confirming — has the pool certificate come through yet? We're a bit anxious about the settlement date approaching...", time:"9:14 AM", unread:true, matter:"CC-2025-041", urgent:true },
  { id:2, from:"Mark Delaney", channel:"email", preview:"Following up on the Mitchell referral fee — happy to invoice if that's easier for you...", time:"8:52 AM", unread:true, matter:"CC-2025-041", urgent:false },
  { id:3, from:"James Nguyen", channel:"whatsapp", preview:"Hey, any update on when we can expect settlement confirmation? My removalists need to book...", time:"Yesterday", unread:true, matter:"CC-2025-039", urgent:true },
  { id:4, from:"LJ Hooker Pymble", channel:"email", preview:"Re: CC-2025-034 — vendor has confirmed they are available for settlement on 2 May...", time:"Yesterday", unread:false, matter:"CC-2025-034", urgent:false },
  { id:5, from:"ANZ Bank", channel:"email", preview:"PEXA workspace WS-9801-2025 — all parties have confirmed participation...", time:"Mon", unread:false, matter:"CC-2025-037", urgent:false },
];

const SETTLEMENTS = [
  { date:"7 Apr", client:"James Nguyen", matter:"CC-2025-039", value:"$890K", daysLeft:30 },
  { date:"14 Apr", client:"Sarah & Tom Mitchell", matter:"CC-2025-041", value:"$1.42M", daysLeft:37 },
  { date:"21 Apr", client:"Priya Sharma", matter:"CC-2025-037", value:"$760K", daysLeft:44 },
  { date:"2 May", client:"David & Karen Wu", matter:"CC-2025-034", value:"$2.15M", daysLeft:55 },
];

const REFERRERS = [
  { id:"REF-001", name:"Mark Delaney", company:"Delaney Finance", type:"Mortgage Broker", phone:"0422 556 991", email:"mark@delaneyfinance.com.au", since:"Jun 2023", referrals:6, feeOwed:300, totalFees:1500, formalAgreement:true, notes:"Best broker partner. Sends 3–4 clients/year. Consistent high-value referrals." },
  { id:"REF-002", name:"Jellis Craig Box Hill", company:"Jellis Craig", type:"Real Estate Agent", phone:"03 9890 1234", email:"boxhill@jelliscraig.com.au", since:"Sep 2023", referrals:4, feeOwed:0, totalFees:1200, formalAgreement:true, notes:"Sends VIC buyers consistently. Consider increasing to $400 fee." },
  { id:"REF-003", name:"Rachel Chen", company:"Individual", type:"Past Client", phone:"0411 887 223", email:"rachel.chen@gmail.com", since:"Mar 2024", referrals:2, feeOwed:0, totalFees:600, formalAgreement:false, notes:"Happy past client. Referred 2 friends. Keep warm — Christmas card list." },
  { id:"REF-004", name:"Raine & Horne Redfern", company:"Raine & Horne", type:"Real Estate Agent", phone:"02 9699 3333", email:"redfern@rainehorne.com.au", since:"Jan 2024", referrals:3, feeOwed:0, totalFees:0, formalAgreement:false, notes:"No formal fee arrangement. Consider formalising relationship." },
  { id:"REF-005", name:"McGrath Balmain", company:"McGrath", type:"Real Estate Agent", phone:"02 9555 1234", email:"balmain@mcgrath.com.au", since:"Jan 2025", referrals:1, feeOwed:0, totalFees:0, formalAgreement:false, notes:"New relationship. High-value referral. Formal agreement opportunity." },
];

const INVOICES = [
  { id:"INV-2025-041", client:"Sarah & Tom Mitchell", matter:"CC-2025-041", amount:2800, status:"pending", due:"1 May 2025" },
  { id:"INV-2025-039", client:"James Nguyen", matter:"CC-2025-039", amount:1650, status:"pending", due:"7 Apr 2025" },
  { id:"INV-2025-028", client:"Anika Patel", matter:"CC-2025-028", amount:1400, status:"paid", due:"28 Mar 2025" },
  { id:"INV-2025-021", client:"Michael Torres", matter:"CC-2025-021", amount:1750, status:"paid", due:"15 Mar 2025" },
];

const firmYTD_data = [
  {m:"Jul",v:2900},{m:"Aug",v:1550},{m:"Sep",v:4200},{m:"Oct",v:1450},
  {m:"Nov",v:2900},{m:"Dec",v:1380},{m:"Jan",v:1550},{m:"Feb",v:2800},{m:"Mar",v:5200},
];

const AI_CANNED = {
  "today": { text:"Here's your day at a glance:", bullets:["4 critical tasks — PEXA creation for Nguyen is most urgent (settlement 7 Apr, 30 days)","Sarah Mitchell emailed about the pool cert — needs a response today","Wu searches ($2.15M Pymble) are overdue — follow up council & water immediately","Mark Delaney is chasing his $300 referral fee — pay today to protect your best referral channel"] },
  "email": { text:"Here's a draft response to Sarah Mitchell about the pool compliance certificate:", bullets:["\"Dear Sarah, Thank you for your message. We've been in contact with McGrath Balmain and have requested the pool compliance certificate as a priority. We expect to receive this by 14 March. Rest assured we are monitoring this closely and will update you as soon as it comes through. Kind regards, Jessica Chen\""] },
  "urgent": { text:"Matters requiring immediate attention:", bullets:["CC-2025-039 Nguyen — PEXA workspace not created, settlement in 30 days. Create today or risk delay.","CC-2025-034 Wu ($2.15M) — All 3 searches overdue since 6 Mar. Finance condition expires 14 Mar.","CC-2025-041 Mitchell — Pool cert outstanding. Special condition at risk if not received by 21 Mar."] },
  "revenue": { text:"Financial summary for your active pipeline:", bullets:["Total active pipeline: $5.22M across 4 matters","YTD revenue recognised: $23,930 (Jul 2024 – Mar 2025)","Outstanding invoices: $4,450 across 2 matters","Best month: March 2025 — $5,200 in fees from 4 new matters","Top client by value: Wu ($2.15M) — premium fee tier applies"] },
  "default": { text:"I can help you with your practice. Try:", bullets:["\"Summarise today's tasks\"","\"Draft an email to Sarah Mitchell\"","\"What matters are most urgent?\"","\"Show me revenue summary\""] },
};
const matchAI = q => {
  const l = q.toLowerCase();
  if (l.includes("summar")||l.includes("today")||l.includes("day")) return AI_CANNED["today"];
  if (l.includes("email")||l.includes("draft")||l.includes("write")) return AI_CANNED["email"];
  if (l.includes("urgent")||l.includes("risk")||l.includes("critical")) return AI_CANNED["urgent"];
  if (l.includes("revenue")||l.includes("money")||l.includes("financ")) return AI_CANNED["revenue"];
  return AI_CANNED["default"];
};

const URGENCY_COLOR = { critical:"#dc2626", high:"#ea580c", medium:"#ca8a04", low:"#16a34a", none:"#94a3b8" };

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

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#0d0f1a; --ink-2:#1e2130; --ink-3:#2d3149;
  --surface:#f9f8f6; --white:#ffffff;
  --border:#e8e6e0; --border-2:#f0ede8;
  --muted:#8b8880; --text:#1a1a2e; --text-2:#4a4860; --text-3:#7b7990;
  --gold:#c9a84c; --gold-light:#fdf8ec; --gold-dim:#e8d5a0;
  --teal:#0f766e; --teal-light:#f0faf9;
  --red:#dc2626; --red-light:#fef2f2;
  --amber:#ca8a04; --amber-light:#fefce8;
  --green:#16a34a; --green-light:#f0fdf4;
  --blue:#1d4ed8; --blue-light:#eff6ff;
  --purple:#7c3aed; --purple-light:#f5f3ff;
  --radius:10px; --radius-sm:6px; --radius-lg:16px;
  --shadow-sm:0 1px 3px rgba(13,15,26,0.06),0 1px 2px rgba(13,15,26,0.04);
  --shadow:0 4px 20px rgba(13,15,26,0.08);
  --shadow-lg:0 16px 48px rgba(13,15,26,0.14);
  --shadow-xl:0 24px 64px rgba(13,15,26,0.2);
  --font-display:'Fraunces',Georgia,serif;
  --font-body:'DM Sans',system-ui,sans-serif;
  --font-mono:'DM Mono',monospace;
}
body{font-family:var(--font-body);background:var(--surface);color:var(--text);overflow:hidden}

@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}
.fade-up{animation:fadeUp 0.35s ease both}
.fade-up-1{animation:fadeUp 0.35s 0.05s ease both}
.fade-up-2{animation:fadeUp 0.35s 0.1s ease both}
.fade-up-3{animation:fadeUp 0.35s 0.15s ease both}

/* ── APP SHELL ── */
.app{display:flex;height:100vh;overflow:hidden;background:var(--surface)}

/* ── SIDEBAR ── */
.sidebar{width:228px;flex-shrink:0;background:var(--ink);display:flex;flex-direction:column;position:relative;overflow:hidden}
.sidebar::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 80%,rgba(201,168,76,0.08) 0%,transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(15,118,110,0.06) 0%,transparent 50%);pointer-events:none}
.sb-brand{padding:24px 20px 18px;border-bottom:1px solid rgba(255,255,255,0.06);position:relative;z-index:1}
.sb-logo{display:flex;align-items:center;gap:10px}
.sb-logo-mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--gold) 0%,#a07830 100%);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;box-shadow:0 2px 8px rgba(201,168,76,0.3)}
.sb-logo-text{font-family:var(--font-display);font-size:16px;font-weight:500;color:#f5f0e8;letter-spacing:-0.2px}
.sb-logo-sub{font-size:9px;color:rgba(255,255,255,0.3);font-family:var(--font-mono);letter-spacing:1.5px;text-transform:uppercase;margin-top:1px}
.sb-nav{flex:1;padding:12px 10px;overflow-y:auto;position:relative;z-index:1}
.sb-nav::-webkit-scrollbar{width:0}
.sb-section{font-size:9px;font-family:var(--font-mono);color:rgba(255,255,255,0.2);letter-spacing:2px;text-transform:uppercase;padding:14px 10px 6px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:rgba(255,255,255,0.45);transition:all 0.15s;margin-bottom:2px;border:none;background:none;width:100%;text-align:left;font-family:var(--font-body);position:relative}
.sb-item:hover{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.8)}
.sb-item.active{background:linear-gradient(90deg,rgba(201,168,76,0.18) 0%,rgba(201,168,76,0.06) 100%);color:var(--gold-dim);font-weight:600}
.sb-item.active::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:18px;background:var(--gold);border-radius:0 3px 3px 0;box-shadow:0 0 8px rgba(201,168,76,0.5)}
.sb-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0;opacity:0.7}
.sb-item.active .sb-icon{opacity:1}
.sb-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:20px;font-family:var(--font-mono)}
.sb-badge.gold{background:var(--gold);color:var(--ink)}
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
.tb-search:focus-within{border-color:var(--gold-dim);background:var(--white);box-shadow:0 0 0 3px var(--gold-light)}
.tb-search input{border:none;background:none;font-size:12px;color:var(--text);outline:none;width:100%;font-family:var(--font-body)}
.tb-search input::placeholder{color:var(--text-3)}
.icon-btn{width:34px;height:34px;border-radius:var(--radius-sm);background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;position:relative;transition:all 0.15s}
.icon-btn:hover{background:var(--white);border-color:var(--gold-dim)}
.icon-btn .dot{position:absolute;top:6px;right:6px;width:7px;height:7px;background:var(--red);border-radius:50%;border:1.5px solid var(--white)}
.btn-primary{background:var(--ink);color:var(--white);border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);transition:all 0.15s;display:flex;align-items:center;gap:6px}
.btn-primary:hover{background:var(--ink-2);box-shadow:var(--shadow)}
.btn-gold{background:linear-gradient(135deg,var(--gold) 0%,#a07830 100%);color:var(--ink);border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
.btn-gold:hover{box-shadow:0 4px 16px rgba(201,168,76,0.35);transform:translateY(-1px)}
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
.tag-gold{background:var(--gold-light);color:#92660a;border:1px solid var(--gold-dim)}
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

/* Settlements */
.settlement-item{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border-2)}
.settlement-item:last-child{border-bottom:none}
.settle-date{font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--text);min-width:40px}
.settle-client{font-size:12px;font-weight:500;color:var(--text);flex:1}
.settle-value{font-size:12px;font-weight:700;color:var(--teal);font-family:var(--font-mono)}

/* AI Panel */
.ai-panel{grid-row:1/4;background:var(--ink);border-radius:var(--radius-lg);display:flex;flex-direction:column;height:100%;overflow:hidden;position:relative;border:1px solid var(--ink-2);box-shadow:var(--shadow-lg)}
.ai-panel::before{content:'';position:absolute;top:0;left:0;right:0;height:200px;background:radial-gradient(ellipse at 50% 0%,rgba(201,168,76,0.12) 0%,transparent 70%);pointer-events:none}
.ai-panel-hdr{padding:20px 18px 14px;border-bottom:1px solid rgba(255,255,255,0.06);position:relative;z-index:1}
.ai-panel-title{font-size:11px;font-family:var(--font-mono);color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px}
.ai-model-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.25);border-radius:20px;padding:4px 10px;font-size:10px;font-weight:600;color:var(--gold-dim);font-family:var(--font-mono)}
.ai-dot{width:6px;height:6px;border-radius:50%;background:var(--gold);animation:pulse 2s ease infinite}
.ai-messages{flex:1;overflow-y:scroll;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:0;max-height:400px;}
.ai-messages::-webkit-scrollbar{width:0}
.ai-msg{display:flex;gap:8px;max-width:100%}
.ai-msg.user{flex-direction:row-reverse}
.ai-msg-avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.ai-msg-avatar.ai-av{background:linear-gradient(135deg,var(--gold),#a07830);color:var(--ink)}
.ai-msg-avatar.user-av{background:linear-gradient(135deg,var(--teal),#0e9488);color:#fff;font-size:8px}
.ai-bubble{padding:9px 12px;border-radius:10px;font-size:11px;line-height:1.65}
.ai-bubble.ai-b{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.75);border-radius:3px 10px 10px 10px}
.ai-bubble.user-b{background:rgba(201,168,76,0.18);border:1px solid rgba(201,168,76,0.25);color:var(--gold-dim);border-radius:10px 3px 10px 10px}
.ai-bullets{list-style:none;margin-top:6px}
.ai-bullets li{font-size:10px;padding:3px 0 3px 14px;position:relative;color:rgba(255,255,255,0.55);line-height:1.6;border-bottom:1px solid rgba(255,255,255,0.04)}
.ai-bullets li:last-child{border-bottom:none}
.ai-bullets li::before{content:'›';position:absolute;left:0;color:var(--gold);font-weight:700}
.ai-typing{display:flex;gap:3px;padding:4px 0}
.typing-dot{width:5px;height:5px;border-radius:50%;background:var(--gold);opacity:0.6;animation:bounce 1.4s ease infinite}
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
.ai-send{background:linear-gradient(135deg,var(--gold),#a07830);color:var(--ink);border:none;border-radius:7px;padding:8px 14px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font-body);transition:all 0.15s}
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

/* ── MATTERS TABLE ── */
.matter-table{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)}
.mt-thead{display:grid;grid-template-columns:120px 1fr 130px 140px 90px 90px 80px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--border);gap:12px}
.mt-th{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px}
.mt-row{display:grid;grid-template-columns:120px 1fr 130px 140px 90px 90px 80px;padding:13px 20px;border-bottom:1px solid var(--border-2);gap:12px;align-items:center;cursor:pointer;transition:all 0.1s}
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
.ws-tab.active{color:var(--ink);font-weight:700;border-bottom-color:var(--gold)}
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
.doc-item:hover{border-color:var(--gold-dim);background:var(--gold-light)}
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
.compose-textarea:focus{border-color:var(--gold-dim);background:var(--white)}
.ai-summary-card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);padding:14px 16px;margin-bottom:14px;box-shadow:var(--shadow-sm)}
.ai-sum-label{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
.ai-sum-item{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-2);font-size:11px;color:var(--text-2);line-height:1.5}
.ai-sum-item:last-child{border-bottom:none}
.ai-sum-dot{width:5px;height:5px;border-radius:50%;background:var(--teal);margin-top:5px;flex-shrink:0}

/* ── REFERRALS ── */
.ref-layout{display:grid;grid-template-columns:290px 1fr;gap:16px;height:calc(100vh - 160px);overflow:hidden}
.ref-list{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);overflow-y:auto;box-shadow:var(--shadow-sm)}
.ref-list-item{padding:14px 16px;border-bottom:1px solid var(--border-2);cursor:pointer;transition:all 0.15s;position:relative}
.ref-list-item:hover{background:var(--surface)}
.ref-list-item.active{background:var(--gold-light);border-right:3px solid var(--gold)}
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
.is-dot.curr{background:var(--ink);color:var(--white);box-shadow:0 0 0 3px rgba(13,15,26,0.1)}
.is-dot.todo{background:var(--surface);color:var(--text-3);border:2px solid var(--border)}
.is-label{font-size:11px;font-weight:500;color:var(--text-2)}
.is-label.curr{color:var(--ink);font-weight:700}
.is-line{flex:1;height:2px;background:var(--border);margin:0 8px}
.is-line.done{background:var(--teal)}
.intake-body{padding:22px 26px}
.intake-source-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
.src-card{padding:14px;border:2px solid var(--border);border-radius:var(--radius);cursor:pointer;text-align:center;transition:all 0.15s;background:var(--surface)}
.src-card:hover{border-color:var(--gold-dim);background:var(--gold-light)}
.src-card.sel{border-color:var(--gold);background:var(--gold-light)}
.src-icon{font-size:22px;margin-bottom:5px}
.src-label{font-size:11px;font-weight:600;color:var(--text)}
.src-desc{font-size:10px;color:var(--text-3);margin-top:2px}
.intake-label{font-size:10px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;display:block}
.intake-input{width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;font-family:var(--font-body);outline:none;color:var(--text);background:var(--surface);transition:all 0.15s}
.intake-input:focus{border-color:var(--gold-dim);background:var(--white);box-shadow:0 0 0 3px var(--gold-light)}
.intake-textarea{width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-size:12px;font-family:var(--font-body);resize:vertical;min-height:90px;outline:none;color:var(--text);background:var(--surface);transition:all 0.15s}
.intake-textarea:focus{border-color:var(--gold-dim);background:var(--white)}
.intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.intake-footer{padding:14px 26px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:0 0 20px 20px}
.extracted-card{background:var(--ink);border-radius:var(--radius-lg);padding:16px 18px;margin-bottom:14px;position:relative;overflow:hidden}
.extracted-card::before{content:'';position:absolute;top:0;right:0;width:80px;height:80px;background:radial-gradient(circle,rgba(201,168,76,0.15) 0%,transparent 70%);pointer-events:none}
.ext-badge{font-size:8px;font-family:var(--font-mono);background:rgba(201,168,76,0.2);border:1px solid rgba(201,168,76,0.3);color:var(--gold-dim);padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;display:inline-block;margin-bottom:10px}
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
.wf-prog-step.current{background:var(--gold-light)}
.wf-prog-step.completed{background:var(--teal-light)}
.wf-prog-icon{font-size:16px;margin-bottom:3px}
.wf-prog-label{font-size:9px;font-family:var(--font-mono);color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;line-height:1.3}
.wf-prog-step.current .wf-prog-label{color:var(--gold);font-weight:700}
.wf-prog-step.completed .wf-prog-label{color:var(--teal)}
.wf-type-selector{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.wf-type-btn{padding:7px 16px;border-radius:20px;font-size:12px;font-weight:500;border:1px solid var(--border);background:var(--white);color:var(--text-2);cursor:pointer;transition:all 0.15s;font-family:var(--font-body)}
.wf-type-btn:hover{border-color:var(--gold-dim);color:var(--text)}
.wf-type-btn.active{background:var(--ink);border-color:var(--ink);color:var(--white);font-weight:600}

/* ── SETTINGS STUB ── */
.under-construction{display:flex;align-items:center;justify-content:center;flex:1;height:100%}

/* ── LOGIN SCREEN ── */
.login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--surface);font-family:var(--font-body)}
.login-card{background:var(--white);border-radius:var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-lg);padding:40px;width:100%;max-width:380px}
.login-logo{display:flex;align-items:center;gap:12px;margin-bottom:32px;justify-content:center}
.login-logo-mark{width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,var(--gold) 0%,#a07830 100%);display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 12px rgba(201,168,76,0.35)}
.login-logo-text{font-family:var(--font-display);font-size:22px;font-weight:500;color:var(--text);letter-spacing:-0.2px}
.login-logo-sub{font-size:10px;color:var(--muted);font-family:var(--font-mono);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px}
.login-field{margin-bottom:18px}
.login-field label{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;font-family:var(--font-body)}
.login-input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;color:var(--text);background:var(--white);font-family:var(--font-body);outline:none;transition:border-color 0.15s}
.login-input:focus{border-color:var(--gold-dim);box-shadow:0 0 0 3px var(--gold-light)}
.login-input::placeholder{color:var(--text-3)}
.login-btn{width:100%;padding:12px;border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-body);background:linear-gradient(135deg,var(--gold) 0%,#a07830 100%);color:var(--ink);transition:all 0.15s;margin-top:8px}
.login-btn:hover:not(:disabled){box-shadow:0 4px 16px rgba(201,168,76,0.35);transform:translateY(-1px)}
.login-btn:disabled{opacity:0.6;cursor:not-allowed;transform:none}
.login-error{font-size:12px;color:var(--red);margin-top:12px;padding:8px 12px;background:var(--red-light);border-radius:var(--radius-sm);font-family:var(--font-body)}
.login-loading{font-family:var(--font-display);font-size:18px;color:var(--text-2)}
.sb-signout{background:none;border:none;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;font-family:var(--font-body);padding:4px 8px;border-radius:6px;margin-left:auto}
.sb-signout:hover{color:var(--gold-dim);background:rgba(255,255,255,0.06)}
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
  const [tasks, setTasks] = useState(TASKS);
  const [modal, setModal] = useState(null);
  const [intakeStep, setIntakeStep] = useState(0);
  const [intakeSource, setIntakeSource] = useState(null);
  const [intakeText, setIntakeText] = useState("");
  const [intakeExtracting, setIntakeExtracting] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { id:0, role:"ai", text:"Good morning, Jessica. Here's what needs your attention today.", bullets:["3 critical tasks — PEXA creation for Nguyen is most urgent","Sarah Mitchell has emailed about the pool cert — needs a reply now","Wu ($2.15M) searches are overdue — follow up immediately"] }
  ]);
  const [aiInput, setAiInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const aiEndRef = useRef(null);

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
          client: row.client_name,
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
        }));
        console.log("Final MATTERS state after setting:", mapped);
        setMATTERS(mapped);
      }

      setMattersLoading(false);
    };

    fetchMatters();
  }, []);

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
  const selComm = COMMS.find(c => c.id === selectedCommId);
  const selRef = REFERRERS.find(r => r.id === selectedRef);

  const pageTitle = {
    dashboard:"Dashboard", matters:"Matters", referrals:"Referrals",
    communications:"Communications", accounting:"Accounting",
    insights:"Insights", settings:"Settings", matter_workspace:"Matter"
  };

  const NAV = [
    { id:"dashboard", icon:"⊞", label:"Dashboard" },
    { id:"matters", icon:"⚖️", label:"Matters", badge:activeM.length },
    { id:"referrals", icon:"🤝", label:"Referrals" },
    { id:"communications", icon:"✉️", label:"Communications", badge:COMMS.filter(c=>c.unread).length },
    { id:"accounting", icon:"💰", label:"Accounting" },
    { id:"insights", icon:"✦", label:"Insights" },
  ];

  const AVATAR_COLORS = ["#0f766e","#1d4ed8","#7c3aed","#ca8a04","#dc2626","#ea580c"];

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
              <div className="sb-logo-mark">⚖️</div>
              <div>
                <div className="sb-logo-text">Conveyancing Crew</div>
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
          <div className="topbar">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {page==="matter_workspace" && (
                <button className="btn-ghost" style={{padding:"5px 10px",fontSize:11}}
                  onClick={() => { setPage("matters"); setSelectedMatter(null); }}>← Matters</button>
              )}
              <div>
                <div className="tb-page">
                  {page==="matter_workspace" && selMatterObj ? selMatterObj.client : pageTitle[page] || "Conveyancing Crew"}
                </div>
                <div className="tb-page-sub">
                  {page==="matter_workspace" && selMatterObj ? selMatterObj.id + " · " + selMatterObj.type : "Conveyancing Crew · NSW & VIC"}
                </div>
              </div>
            </div>
            <div className="tb-right">
              <div className="tb-search">
                <span style={{color:"var(--text-3)",fontSize:12}}>🔍</span>
                <input placeholder="Search matters, clients..." />
              </div>
              <div className="icon-btn">🔔<div className="dot"/></div>
              <button className="btn-gold" onClick={() => setModal("intake")}>＋ New Matter</button>
            </div>
          </div>

          {/* ══════════════════════════════════════════════
              DASHBOARD
          ══════════════════════════════════════════════ */}
          {page === "dashboard" && (
            <div className="content">
              {/* Quick actions */}
              <div className="quick-actions fade-up">
                {[
                  {icon:"＋",label:"New Matter",primary:true,action:()=>setModal("intake")},
                  {icon:"⚖️",label:"View Matters",action:()=>setPage("matters")},
                  {icon:"✉️",label:"Inbox",action:()=>setPage("communications")},
                  {icon:"🤝",label:"Referrals",action:()=>setPage("referrals")},
                  {icon:"💰",label:"Accounting",action:()=>setPage("accounting")},
                ].map(a => (
                  <button key={a.label} className={`qa-btn ${a.primary?"qa-primary":""}`} onClick={a.action}>
                    <span className="qa-icon">{a.icon}</span>{a.label}
                  </button>
                ))}
              </div>

              {/* Stat row */}
              <div className="stat-row fade-up-1">
                {[
                  {label:"Active Matters",value:activeM.length,sub:"in pipeline",cls:""},
                  {label:"This Month",value:"$5,200",sub:"fees recognised",cls:"stat-gold"},
                  {label:"Settlements",value:"3",sub:"due this month",cls:"stat-accent"},
                  {label:"Outstanding",value:"$4,450",sub:"invoices",cls:"stat-red"},
                  {label:"Avg Days",value:"31",sub:"per matter",cls:""},
                ].map(s => (
                  <div key={s.label} className={`stat ${s.cls}`}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value">{s.value}</div>
                    <div className="stat-sub">{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Main grid */}
              <div className="dash-grid fade-up-2">

                {/* Today's Tasks */}
                <div className="card">
                  <div className="card-hdr">
                    <div className="card-title">📋 Today's Tasks <span className="tag tag-red">{tasks.filter(t=>!t.done&&t.due==="Today").length} due</span></div>
                    <div className="card-sub">8 Mar 2025</div>
                  </div>
                  <div style={{padding:"4px 20px 14px"}}>
                    {tasks.filter(t=>t.due==="Today"||t.due==="Tomorrow").slice(0,5).map(t => (
                      <div key={t.id} className="task-item">
                        <div style={{width:5,height:5,borderRadius:"50%",background:URGENCY_COLOR[t.urgency]||"#94a3b8",flexShrink:0,marginTop:6}}/>
                        <div className={`task-check ${t.done?"done":""}`}
                          onClick={() => setTasks(prev=>prev.map(x=>x.id===t.id?{...x,done:!x.done}:x))}>
                          {t.done && "✓"}
                        </div>
                        <div className="task-body">
                          <div className={`task-text ${t.done?"done-text":""}`}>{t.task}</div>
                          <div className="task-meta">{t.client} · {t.matter} · {t.due}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Upcoming Settlements */}
                <div className="card">
                  <div className="card-hdr">
                    <div className="card-title">🏠 Upcoming Settlements</div>
                    <div className="card-sub">Next 60 days</div>
                  </div>
                  <div style={{padding:"4px 20px 14px"}}>
                    {SETTLEMENTS.map(s => (
                      <div key={s.matter} className="settlement-item">
                        <div className="settle-date">{s.date}</div>
                        <div style={{flex:1}}>
                          <div className="settle-client">{s.client}</div>
                          <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{s.matter}</div>
                        </div>
                        <div className="settle-value">{s.value}</div>
                        <span className={`tag ${s.daysLeft<=30?"tag-red":s.daysLeft<=45?"tag-amber":"tag-green"}`}>{s.daysLeft}d</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Communications */}
                <div className="card">
                  <div className="card-hdr">
                    <div className="card-title">✉️ Communications <span className="tag tag-teal">{COMMS.filter(c=>c.unread).length} unread</span></div>
                    <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>setPage("communications")}>View all</button>
                  </div>
                  <div>
                    {COMMS.slice(0,4).map(c => {
                      const initials = c.from.split(" ").map(w=>w[0]).join("").slice(0,2);
                      const ci = c.id % AVATAR_COLORS.length;
                      return (
                        <div key={c.id} className="comm-item"
                          onClick={() => { setPage("communications"); setSelectedCommId(c.id); }}>
                          <div className="comm-avatar" style={{background:`linear-gradient(135deg,${AVATAR_COLORS[ci]},${AVATAR_COLORS[(ci+1)%AVATAR_COLORS.length]})`}}>{initials}</div>
                          <div className="comm-body">
                            <div className="comm-name">
                              <span className={c.unread?"unread-name":""}>{c.from}</span>
                              <span className="tag" style={{fontSize:9,padding:"1px 6px",background:c.channel==="email"?"#eff6ff":c.channel==="whatsapp"?"#f0fdf4":"#fdf4ff",color:c.channel==="email"?"#1d4ed8":c.channel==="whatsapp"?"#16a34a":"#9333ea"}}>{CHANNEL_ICONS[c.channel]} {c.channel}</span>
                              {c.urgent && <span style={{width:6,height:6,borderRadius:"50%",background:"var(--red)",display:"inline-block"}}/>}
                            </div>
                            <div className="comm-preview">{c.preview}</div>
                          </div>
                          <div>
                            <div className="comm-time">{c.time}</div>
                            {c.unread && <div className="comm-unread-dot" style={{marginLeft:"auto",marginTop:4}}/>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AI CO-PILOT PANEL — spans full height */}
                <div className="ai-panel">
                  <div className="ai-panel-hdr">
                    <div className="ai-panel-title">AI Co-pilot</div>
                    <div className="ai-model-badge"><div className="ai-dot"/>Crew Intelligence · Active</div>
                  </div>
                  <div className="ai-messages">
                    {aiMessages.map(m => (
                      <div key={m.id} className={`ai-msg ${m.role}`}>
                        <div className={`ai-msg-avatar ${m.role==="ai"?"ai-av":"user-av"}`}>
                          {m.role==="ai" ? "✦" : "JC"}
                        </div>
                        <div className={`ai-bubble ${m.role==="ai"?"ai-b":"user-b"}`}>
                          <div>{m.text}</div>
                          {m.bullets && <ul className="ai-bullets">{m.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul>}
                        </div>
                      </div>
                    ))}
                    {isTyping && (
                      <div className="ai-msg">
                        <div className="ai-msg-avatar ai-av">✦</div>
                        <div className="ai-bubble ai-b"><div className="ai-typing"><div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/></div></div>
                      </div>
                    )}
                    <div ref={aiEndRef}/>
                  </div>
                  <div className="ai-input-area">
                    <div className="ai-quick-prompts">
                      {["Summarise today's tasks","Draft reply to Sarah Mitchell","What matters are most urgent?","Show revenue summary"].map(q => (
                        <button key={q} className="ai-qp" onClick={()=>sendAI(q)}>💬 {q}</button>
                      ))}
                    </div>
                    <div className="ai-input-row">
                      <input className="ai-input" placeholder="Ask me anything..."
                        value={aiInput} onChange={e=>setAiInput(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&sendAI()} />
                      <button className="ai-send" onClick={()=>sendAI()}>›</button>
                    </div>
                  </div>
                </div>

                {/* Financial Overview */}
                <div className="card col-span-2" style={{gridColumn:"span 2"}}>
                  <div className="card-hdr">
                    <div className="card-title">💰 Financial Overview</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div className="xero-badge">✓ Xero Synced</div>
                      <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>setPage("accounting")}>Full Accounting →</button>
                    </div>
                  </div>
                  <div style={{padding:"8px 20px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
                    <div style={{paddingRight:20,borderRight:"1px solid var(--border-2)"}}>
                      {[{l:"YTD Revenue",v:"$23,930",badge:"",bc:""},{l:"This Month",v:"$5,200",badge:"+23%",bc:"tag-green"},{l:"Active Pipeline",v:"$5,220,000",badge:"",bc:""},{l:"Avg Fee / Matter",v:"$1,640",badge:"",bc:""}].map(r=>(
                        <div key={r.l} className="fin-row">
                          <span className="fin-label">{r.l}</span>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            {r.badge&&<span className={`tag ${r.bc}`}>{r.badge}</span>}
                            <span className="fin-val">{r.v}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{paddingLeft:20}}>
                      {[{l:"Outstanding Invoices",v:"$4,450",badge:"2 pending",bc:"tag-amber"},{l:"Received This Month",v:"$3,150",badge:"",bc:""},{l:"Referral Fees Paid",v:"$1,500",badge:"",bc:""},{l:"Referral Fees Owed",v:"$300",badge:"Due today",bc:"tag-red"}].map(r=>(
                        <div key={r.l} className="fin-row">
                          <span className="fin-label">{r.l}</span>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            {r.badge&&<span className={`tag ${r.bc}`}>{r.badge}</span>}
                            <span className="fin-val">{r.v}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* AI Flagged */}
                <div className="card">
                  <div className="card-hdr">
                    <div className="card-title">✦ AI Flagged</div>
                    <span className="tag tag-gold">3 critical</span>
                  </div>
                  <div style={{padding:"6px 16px 14px"}}>
                    {[
                      {from:"Sarah Mitchell",subject:"Pool certificate?",action:"Needs reply today",urgency:"critical"},
                      {from:"James Nguyen",subject:"Settlement confirmation",action:"PEXA workspace needed",urgency:"critical"},
                      {from:"Mark Delaney",subject:"Referral fee follow-up",action:"Pay $300 outstanding",urgency:"high"},
                    ].map((e,i)=>(
                      <div key={i} style={{padding:"9px 0",borderBottom:"1px solid var(--border-2)",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:e.urgency==="critical"?"var(--red)":"var(--amber)",flexShrink:0,marginTop:5}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,fontWeight:600,color:"var(--text)",marginBottom:2}}>{e.from} <span style={{fontWeight:400,color:"var(--text-3)"}}>— {e.subject}</span></div>
                          <div style={{fontSize:10,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>{e.action}</div>
                        </div>
                        <button className="btn-ghost" style={{fontSize:10,padding:"3px 9px",flexShrink:0}} onClick={()=>setPage("communications")}>Reply</button>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

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
                  <div className="matter-table fade-up-2">
                    <div className="mt-thead">
                      {["Matter ID","Client / Address","Type","Stage","Value","Staff","Action"].map(h=><div key={h} className="mt-th">{h}</div>)}
                    </div>
                    {(mFilter==="all"?MATTERS:mFilter==="active"?activeM:closedM).map(m=>(
                      <div key={m.id} className="mt-row"
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
                        <div>
                          <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}}
                            onClick={e=>{e.stopPropagation();setSelectedMatter(m.id);setPage("matter_workspace");setMatterTab("Overview");}}>
                            Open →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

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
                  </div>
                </div>
                <div className="ws-tabs">
                  {["Overview","Workflow","Timeline","Documents","Tasks","Communications","Billing","AI Assistant"].map(t=>(
                    <button key={t} className={`ws-tab ${matterTab===t?"active":""}`} onClick={()=>setMatterTab(t)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="ws-content">

                {/* OVERVIEW */}
                {matterTab==="Overview" && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
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
                          {Object.entries(selMatterObj.searches).map(([k,v])=>(
                            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border-2)",fontSize:11}}>
                              <span style={{color:"var(--text-2)",textTransform:"capitalize"}}>{k} Search</span>
                              <span className={`tag ${v==="done"?"tag-green":v==="pending"?"tag-amber":"tag-gray"}`}>{v==="n/a"?"N/A":v}</span>
                            </div>
                          ))}
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
                      <div className="card-title">{selMatterObj.contracts?.length||0} documents</div>
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn-ghost" style={{fontSize:12}}>📎 Upload</button>
                        <button className="btn-primary" style={{fontSize:12}}>✦ Generate</button>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      {(selMatterObj.contracts||[]).map((d,i)=>(
                        <div key={i} className="doc-item">
                          <div className="doc-icon" style={{background:d.type==="executed"?"#f0fdf4":d.type==="draft"?"#fefce8":d.type==="s32"?"#f5f3ff":"#eff6ff"}}>
                            {d.type==="executed"?"✅":d.type==="draft"?"📝":d.type==="s32"?"📋":"📤"}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div className="doc-name">{d.name}</div>
                            <div className="doc-meta">{d.date} · PDF</div>
                          </div>
                          <button style={{fontSize:11,color:"var(--text-3)",background:"none",border:"none",cursor:"pointer",flexShrink:0}}>↗</button>
                        </div>
                      ))}
                      {(!selMatterObj.contracts||selMatterObj.contracts.length===0)&&(
                        <div style={{fontSize:12,color:"var(--text-3)",padding:"12px 0"}}>No documents yet.</div>
                      )}
                    </div>
                  </div>
                )}

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

                {/* COMMUNICATIONS */}
                {matterTab==="Communications" && (
                  <div style={{display:"flex",gap:16,height:"calc(100vh - 280px)"}}>
                    <div style={{flex:1,display:"flex",flexDirection:"column",gap:10,overflow:"hidden"}}>
                      <div style={{flex:1,overflow:"auto",background:"var(--surface)",borderRadius:12,border:"1px solid var(--border)",padding:16,display:"flex",flexDirection:"column",gap:12}}>
                        {COMMS.filter(c=>c.matter===selMatterObj.id).map((c,i)=>(
                          <div key={i} className="thread-msg incoming">
                            <div className="thread-meta">{c.from} · {c.time}</div>
                            <div className="thread-bubble incoming">{c.preview}</div>
                          </div>
                        ))}
                        {COMMS.filter(c=>c.matter===selMatterObj.id).length===0&&(
                          <div style={{fontSize:12,color:"var(--text-3)",padding:"12px 0"}}>No communications for this matter.</div>
                        )}
                      </div>
                      <div>
                        <textarea className="compose-textarea" placeholder="Type your reply... (or use AI to draft)"/>
                        <div style={{display:"flex",gap:8,marginTop:8}}>
                          <button className="btn-ghost" style={{fontSize:12}} onClick={()=>sendAI("draft email")}>✦ AI Draft</button>
                          <div style={{flex:1}}/>
                          <button className="btn-primary" style={{fontSize:12}}>Send ✉️</button>
                        </div>
                      </div>
                    </div>
                    <div style={{width:260,flexShrink:0}}>
                      <div className="ai-summary-card">
                        <div className="ai-sum-label">✦ AI Summary</div>
                        {["Client needs update — respond promptly","Tone: polite but anxious","Check search/contract status before replying"].map((s,i)=>(
                          <div key={i} className="ai-sum-item"><div className="ai-sum-dot"/><span>{s}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

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
                    {INVOICES.filter(inv=>inv.matter===selMatterObj.id).map(inv=>(
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
                    {INVOICES.filter(inv=>inv.matter===selMatterObj.id).length===0&&(
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
                      {label:"Total Referrers",value:REFERRERS.length,sub:"partners",cls:""},
                      {label:"Total Referrals",value:REFERRERS.reduce((s,r)=>s+r.referrals,0),sub:"all time",cls:"stat-accent"},
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
                  {REFERRERS.map(r=>(
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
              COMMUNICATIONS
          ══════════════════════════════════════════════ */}
          {page === "communications" && (
            <div style={{display:"flex",flex:1,overflow:"hidden",height:"calc(100vh - 58px)"}}>
              <div className="comms-left" style={{width:280,flexShrink:0}}>
                <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:8}}>Inbox</div>
                  <div style={{display:"flex",gap:6}}>
                    {["all","email","whatsapp"].map(f=>(
                      <button key={f} className={`filter-btn ${commTab===f?"active":""}`} style={{fontSize:10,padding:"3px 8px"}} onClick={()=>setCommTab(f)}>{f}</button>
                    ))}
                  </div>
                </div>
                {COMMS.filter(c=>commTab==="all"||c.channel===commTab).map(c=>{
                  const initials = c.from.split(" ").map(w=>w[0]).join("").slice(0,2);
                  return (
                    <div key={c.id} className="comm-item"
                      style={{background:selectedCommId===c.id?"var(--gold-light)":"",borderLeft:selectedCommId===c.id?"3px solid var(--gold)":""}}
                      onClick={()=>setSelectedCommId(c.id)}>
                      <div className="comm-avatar" style={{background:`linear-gradient(135deg,${AVATAR_COLORS[c.id%AVATAR_COLORS.length]},${AVATAR_COLORS[(c.id+1)%AVATAR_COLORS.length]})`}}>{initials}</div>
                      <div className="comm-body">
                        <div className="comm-name"><span className={c.unread?"unread-name":""}>{c.from}</span></div>
                        <div className="comm-preview">{c.preview}</div>
                      </div>
                      <div>{c.unread&&<div className="comm-unread-dot"/>}</div>
                    </div>
                  );
                })}
              </div>
              <div className="comms-main" style={{flex:1,borderRight:"1px solid var(--border)"}}>
                {selComm && (
                  <>
                    <div style={{padding:"14px 20px",borderBottom:"1px solid var(--border)",background:"var(--white)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{selComm.from}</div>
                        <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{selComm.matter} · {selComm.channel} · {selComm.time}</div>
                      </div>
                      <button className="btn-ghost" style={{fontSize:12}} onClick={()=>{setSelectedMatter(selComm.matter);setPage("matter_workspace");}}>View Matter →</button>
                    </div>
                    <div className="comms-thread">
                      <div className="thread-msg incoming">
                        <div className="thread-meta">{selComm.from} · {selComm.time}</div>
                        <div className="thread-bubble incoming">{selComm.preview}</div>
                      </div>
                      <div className="thread-msg outgoing">
                        <div className="thread-meta" style={{textAlign:"right"}}>You (drafted)</div>
                        <div className="thread-bubble outgoing">Thank you for your message. We are following up with the vendor's agent and will update you shortly.</div>
                      </div>
                    </div>
                    <div className="comms-compose">
                      <textarea className="compose-textarea" placeholder="Type a reply..."/>
                      <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center"}}>
                        <button className="btn-ghost" style={{fontSize:11}} onClick={()=>sendAI("draft email")}>✦ AI Draft</button>
                        <div style={{flex:1}}/>
                        <button className="btn-primary">Send</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div style={{width:280,flexShrink:0,padding:16,background:"var(--surface)",overflowY:"auto",borderLeft:"1px solid var(--border)"}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginBottom:12}}>✦ AI Analysis</div>
                {selComm && (
                  <>
                    <div className="ai-summary-card">
                      <div className="ai-sum-label">Key Points</div>
                      {["Client seeking update on their matter","Tone is concerned — respond promptly","Check status before replying"].map((s,i)=>(
                        <div key={i} className="ai-sum-item"><div className="ai-sum-dot"/><span>{s}</span></div>
                      ))}
                    </div>
                    <div className="ai-summary-card">
                      <div className="ai-sum-label">Suggested Actions</div>
                      {["Reply within 1 hour","Follow up with agent","Update client status"].map((s,i)=>(
                        <div key={i} className="ai-sum-item"><div className="ai-sum-dot" style={{background:"var(--amber)"}}/><span>{s}</span></div>
                      ))}
                    </div>
                    <button className="btn-gold" style={{width:"100%",marginTop:8}} onClick={()=>sendAI("draft email")}>✦ Draft AI Reply</button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              ACCOUNTING
          ══════════════════════════════════════════════ */}
          {page === "accounting" && (
            <div className="content">
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <div className="xero-badge" style={{fontSize:10,padding:"4px 12px"}}>✓ Xero Connected</div>
                <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"var(--font-mono)"}}>Last synced: 2 min ago</span>
                <div style={{flex:1}}/>
                <button className="btn-ghost" style={{fontSize:12}}>⟳ Sync Xero</button>
                <button className="btn-gold">＋ Create Invoice</button>
              </div>
              <div className="acc-grid">
                {[
                  {icon:"💰",label:"YTD Revenue",val:"$23,930",sub:"Jul 2024 – Mar 2025"},
                  {icon:"📥",label:"Received (March)",val:"$3,150",sub:"↑ 12% vs Feb"},
                  {icon:"⏳",label:"Outstanding",val:"$4,450",sub:"2 invoices"},
                  {icon:"📤",label:"Referral Fees",val:"$1,800",sub:"paid this year"},
                ].map(s=>(
                  <div key={s.label} className="acc-stat">
                    <div className="acc-stat-icon">{s.icon}</div>
                    <div className="acc-stat-label">{s.label}</div>
                    <div className="acc-stat-val">{s.val}</div>
                    <div style={{fontSize:10,color:"var(--text-3)",marginTop:2}}>{s.sub}</div>
                  </div>
                ))}
              </div>
              <div className="matter-table">
                <div className="inv-row inv-thead" style={{background:"var(--surface)",borderBottom:"1px solid var(--border)"}}>
                  {["Invoice ID","Client / Matter","Amount","Status","Due Date","Action"].map(h=>(
                    <div key={h} style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"1px"}}>{h}</div>
                  ))}
                </div>
                {INVOICES.map(inv=>(
                  <div key={inv.id} className="inv-row" style={{background:"var(--white)"}}>
                    <div className="inv-id">{inv.id}</div>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:"var(--text)"}}>{inv.client}</div>
                      <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{inv.matter}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:700,fontFamily:"var(--font-mono)",color:"var(--text)"}}>${inv.amount.toLocaleString()}</div>
                    <div><span className={`tag ${inv.status==="paid"?"tag-green":"tag-amber"}`}>{inv.status}</span></div>
                    <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--text-3)"}}>{inv.due}</div>
                    <div style={{display:"flex",gap:6}}>
                      <button className="btn-ghost" style={{fontSize:11,padding:"4px 9px"}}>View</button>
                      {inv.status!=="paid"&&<button className="btn-gold" style={{fontSize:11,padding:"4px 9px"}}>Send</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════
              INSIGHTS
          ══════════════════════════════════════════════ */}
          {page === "insights" && (
            <div className="content">
              <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16,height:"calc(100vh - 110px)"}}>
                <div style={{overflowY:"auto"}}>
                  <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                    {["Which matters are most profitable?","Which clients generate most revenue?","What tasks are overdue?","Show settlement forecast"].map(q=>(
                      <button key={q} className="filter-btn" onClick={()=>sendAI(q)}>✦ {q}</button>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">📊 Monthly Revenue — FY 2024–25</div></div>
                      <div style={{padding:"8px 16px 14px"}}>
                        <div className="chart-wrap">
                          {firmYTD_data.map((d,i)=>(
                            <div key={d.m} className="chart-bar"
                              style={{height:`${(d.v/5200)*100}%`,background:i===firmYTD_data.length-1?"linear-gradient(to top,var(--gold),rgba(201,168,76,0.3))":"linear-gradient(to top,var(--teal),rgba(15,118,110,0.2))"}}>
                              <div className="chart-bar-label">{d.m}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-hdr"><div className="card-title">🔗 Revenue by Referrer</div></div>
                      <div style={{padding:"8px 16px 14px"}}>
                        {[{name:"Mark Delaney",val:"$9,870",pct:42},{name:"Jellis Craig Box Hill",val:"$6,200",pct:26},{name:"Raine & Horne Redfern",val:"$4,100",pct:17},{name:"Direct / Website",val:"$3,760",pct:15}].map(r=>(
                          <div key={r.name} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
                              <span style={{color:"var(--text-2)",fontWeight:500}}>{r.name}</span>
                              <span style={{color:"var(--text)",fontWeight:700,fontFamily:"var(--font-mono)"}}>{r.val}</span>
                            </div>
                            <div style={{height:6,background:"var(--surface)",borderRadius:10,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${r.pct}%`,background:"linear-gradient(90deg,var(--teal),rgba(15,118,110,0.4))",borderRadius:10}}/>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
                    {[
                      {title:"Matter Type Mix",items:[{l:"Purchase",v:"67%",c:"var(--teal)"},{l:"Sale",v:"22%",c:"var(--amber)"},{l:"Other",v:"11%",c:"var(--text-3)"}]},
                      {title:"State Split",items:[{l:"NSW",v:"83%",c:"var(--teal)"},{l:"VIC",v:"17%",c:"var(--gold)"}]},
                      {title:"Client Source",items:[{l:"Website",v:"50%",c:"var(--teal)"},{l:"Referral",v:"33%",c:"var(--blue)"},{l:"Email",v:"17%",c:"var(--amber)"}]},
                    ].map(s=>(
                      <div key={s.title} className="card">
                        <div className="card-hdr"><div className="card-title">{s.title}</div></div>
                        <div style={{padding:"8px 16px 14px"}}>
                          {s.items.map(item=>(
                            <div key={item.l} style={{marginBottom:8}}>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                                <span style={{color:"var(--text-2)"}}>{item.l}</span>
                                <span style={{fontWeight:700,fontFamily:"var(--font-mono)",color:item.c}}>{item.v}</span>
                              </div>
                              <div style={{height:5,background:"var(--surface)",borderRadius:10,overflow:"hidden"}}>
                                <div style={{height:"100%",width:item.v,background:item.c,borderRadius:10,opacity:0.7}}/>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:12,overflow:"hidden"}}>
                  <div style={{flex:1,background:"var(--ink)",borderRadius:14,padding:16,display:"flex",flexDirection:"column",overflow:"hidden",border:"1px solid var(--ink-2)"}}>
                    <div style={{fontSize:10,fontFamily:"var(--font-mono)",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"2px",marginBottom:10}}>✦ Ask Crew Intelligence</div>
                    <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
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
                    <div style={{display:"flex",gap:6}}>
                      <input className="ai-input" style={{flex:1}} placeholder="Ask about firm data..."
                        value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendAI()}/>
                      <button className="ai-send" onClick={()=>sendAI()}>›</button>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-hdr"><div className="card-title">📈 Market Context</div></div>
                    <div style={{padding:"8px 16px 14px"}}>
                      {[{l:"Sydney median",v:"$1.62M",c:"+6.4%"},{l:"Melbourne median",v:"$1.06M",c:"+3.1%"},{l:"Pymble NSW",v:"$2.17M",c:"+3.7%"},{l:"Balmain NSW",v:"$1.49M",c:"+3.1%"}].map(r=>(
                        <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border-2)",fontSize:11}}>
                          <span style={{color:"var(--text-2)"}}>{r.l}</span>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <span style={{fontWeight:700,fontFamily:"var(--font-mono)",color:"var(--text)"}}>{r.v}</span>
                            <span style={{fontSize:9,color:"var(--green)",fontFamily:"var(--font-mono)"}}>{r.c}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Catch-all */}
          {!["dashboard","matters","matter_workspace","referrals","communications","accounting","insights"].includes(page) && (
            <div className="under-construction">
              <div style={{textAlign:"center",color:"var(--text-3)"}}>
                <div style={{fontFamily:"var(--font-display)",fontSize:48,opacity:0.15,marginBottom:12}}>⚖</div>
                <div style={{fontFamily:"var(--font-display)",fontSize:20,color:"var(--text)",marginBottom:6}}>{pageTitle[page]||page}</div>
                <div style={{fontSize:12}}>This section is coming soon.</div>
              </div>
            </div>
          )}

        </div>{/* /main */}
      </div>{/* /app */}

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
                  <div className="intake-grid">
                    {[["Phone",""],["Email",""],["Agent",""],["Source","Website"],["Type","Purchase"],["State","NSW"]].map(([l,d])=>(
                      <div key={l}>
                        <label className="intake-label">{l}</label>
                        <input className="intake-input" defaultValue={d} placeholder={`Enter ${l.toLowerCase()}...`}/>
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
    </>
  );
}

