import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  ShadingType,
} from "docx";

export const maxDuration = 60;

const BLUE = "245EB0";
const GREY_HEADER = "E8E8E8";
const HEADER_GREY = "666666";

function safeFilenamePart(s) {
  return String(s || "matter").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parsePriceNum(row) {
  const p = row?.price ?? row?.property_value;
  if (p == null || p === "") return null;
  const n = Number(String(p).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

function splitLines(s) {
  if (s == null || s === "") return ["—"];
  const t = String(s);
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : ["—"];
}

function normState(state) {
  const s = String(state || "NSW").trim().toUpperCase();
  if (s === "VIC" || s === "VICTORIA") return "VIC";
  if (s === "NSW" || s === "NEW SOUTH WALES") return "NSW";
  return "NSW";
}

function hdrCell(text, widthPct) {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: { fill: GREY_HEADER, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text), bold: true, size: 20 })],
      }),
    ],
  });
}

function bodyCell(text, widthPct) {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text), size: 22 })],
      }),
    ],
  });
}

function heading(text, level = 1) {
  const size = level === 1 ? 32 : 26;
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        bold: true,
        color: BLUE,
        size,
      }),
    ],
  });
}

function subHeading(text) {
  return new Paragraph({
    spacing: { before: 120, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: BLUE })],
  });
}

function buildSection3Items(vi) {
  const items = [];
  if (!vi) return ["No vendor instruction form on file — add conditions manually as required."];
  const pos = vi.possession_type;
  if (pos === "tenanted") {
    items.push(
      `The property is sold subject to existing tenancy. Tenant: ${vi.tenant_name || "—"}. Weekly rent: $${vi.weekly_rent ?? "—"}. Lease expiry: ${vi.tenant_lease_expiry || "—"}.`
    );
  }
  if (vi.has_mortgage) {
    items.push(
      `The vendor warrants that the mortgage with ${vi.lender_name || "the lender"} will be discharged at or before settlement.`
    );
  }
  if (vi.building_works_last_7_years) {
    items.push(
      `The vendor discloses that building works were carried out in the last 7 years: ${vi.building_works_details || "—"}. Relevant permits to be provided.`
    );
  }
  if (vi.owner_builder) {
    items.push("Owner builder warranty insurance details to be attached to the contract.");
  }
  if (vi.pool_or_spa) {
    items.push("Pool/spa compliance certificate to be attached prior to exchange.");
  }
  if (vi.special_conditions && String(vi.special_conditions).trim()) {
    items.push(`Additional special conditions: ${vi.special_conditions}`);
  }
  if (vi.additional_notes && String(vi.additional_notes).trim()) {
    items.push(`Additional vendor instructions: ${vi.additional_notes}`);
  }
  if (items.length === 0) {
    return ["No automated special conditions drafted from vendor data — review and add as required."];
  }
  return items;
}

function nswPrescribedRows(matter, vi) {
  const smokeOk = vi?.smoke_alarms_compliant === true;
  const pool = vi?.pool_or_spa;
  const bworks = vi?.building_works_last_7_years;
  return [
    ["Title Search", "Yes", "⚠ Order required", "1-2 days"],
    ["Section 10.7 Planning Certificate", "Yes", "⚠ Order required", "5-10 days"],
    ["Sydney Water Section 66 Certificate", "Yes", "⚠ Order required", "1-3 days"],
    ["Sewer Diagram", "Yes", "⚠ Order required", "1-2 days"],
    ["Land Tax Clearance Certificate", "Yes", "⚠ Order required", "2-3 days"],
    [
      "Smoke Alarm Compliance",
      "Yes",
      smokeOk ? "✓ Vendor confirmed compliant" : "⚠ Confirm",
      "N/A",
    ],
    ["Pool Certificate", "If applicable", pool ? "⚠ Required" : "N/A", "5-10 days"],
    [
      "Building Works Disclosure",
      "If applicable",
      bworks ? "⚠ Required" : "N/A",
      "N/A",
    ],
  ];
}

function vicPrescribedRows(matter, vi) {
  const strata = matter?.is_strata === true;
  const bworks = vi?.building_works_last_7_years;
  return [
    ["Certificate of Title", "Yes", "⚠ Order required", "1-2 days"],
    ["Land Information Certificate", "Yes", "⚠ Order required", "5-10 days"],
    ["VicRoads Certificate", "Yes", "⚠ Order required", "3-5 days"],
    ["Rates Certificate", "Yes", "⚠ Order required", "3-5 days"],
    ["Water/Sewerage Certificate", "Yes", "⚠ Order required", "5-7 days"],
    [
      "Owners Corporation Certificate",
      "If strata",
      strata ? "⚠ Required" : "N/A",
      "5-10 days",
    ],
    [
      "Building Permit Disclosure (last 7 years)",
      "If applicable",
      bworks ? "⚠ Required" : "N/A",
      "N/A",
    ],
  ];
}

function costTableRows(state) {
  if (state === "VIC") {
    return [
      ["Certificate of Title", "Direct $25", "triSearch ~$60", "$35", "land.vic.gov.au"],
      ["Land Information Certificate", "Council ~$165", "triSearch ~$220", "$55", "your local council website"],
      ["VicRoads Certificate", "Direct $32", "triSearch ~$85", "$53", "vicroads.vic.gov.au"],
      ["Water/Sewerage Certificate", "Direct $28", "triSearch ~$75", "$47", "your water authority (YVW / SEW / CWW by suburb)"],
      ["Rates Certificate", "Council ~$55", "triSearch ~$95", "$40", "your local council"],
      ["TOTAL SAVING", "$232", "—", "—", "—"],
    ];
  }
  return [
    ["Council Certificate (s603)", "Statutory $100", "triSearch $190", "$90", "olg.nsw.gov.au / direct to your council"],
    ["Sydney Water Section 66 Certificate", "Direct $40", "triSearch $190", "$150", "sydneywater.com.au/tap-in"],
    ["Land Tax Clearance", "Direct $15", "triSearch $80", "$65", "revenue.nsw.gov.au"],
    ["Title Search", "InfoTrack $30", "triSearch ~$60", "$30", "infotrack.com.au"],
    ["Planning Certificate (s10.7)", "Council $53", "triSearch ~$120", "$67", "planningportal.nsw.gov.au"],
    ["TOTAL SAVING", "$402", "—", "—", "—"],
  ];
}

function formatViValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** All vendor_instructions columns for reference (sorted by field name). */
function vendorRecordRows(vi) {
  if (!vi) {
    return [["—", "No vendor_instructions row found for this matter."]];
  }
  return Object.keys(vi)
    .sort()
    .map((k) => [k, formatViValue(vi[k])]);
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const matterRef = body?.matterRef;
  if (!matterRef || typeof matterRef !== "string") {
    return NextResponse.json({ error: "matterRef is required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const supabase = createClient(url, key);

  const { data: matter, error: matterErr } = await supabase
    .from("matters")
    .select("*")
    .eq("matter_ref", matterRef)
    .maybeSingle();

  if (matterErr) {
    return NextResponse.json({ error: matterErr.message }, { status: 500 });
  }
  if (!matter) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const { data: vi } = await supabase
    .from("vendor_instructions")
    .select("*")
    .eq("matter_ref", matterRef)
    .maybeSingle();

  const state = normState(matter.state);
  const priceNum = parsePriceNum(matter);
  const depositStr =
    priceNum != null ? formatMoney(Math.round(priceNum * 0.1 * 100) / 100) : "—";
  const priceStr = priceNum != null ? formatMoney(priceNum) : "—";
  const settlement =
    matter.settlement_date != null && String(matter.settlement_date).trim()
      ? String(matter.settlement_date)
      : "To be confirmed";

  const entityLine =
    vi?.entity_name || vi?.entity_abn
      ? `${vi?.entity_name || ""}${vi?.entity_abn ? ` (${vi.entity_abn})` : ""}`.trim()
      : "—";

  const agentBits = [
    matter.agent_name || "",
    matter.agent_phone || "",
    matter.agent_email || "",
  ]
    .map((s) => String(s).trim())
    .filter(Boolean);
  const agentLine = agentBits.length ? agentBits.join(" | ") : "—";

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const fileDate = today.toISOString().split("T")[0];
  const year = today.getFullYear();

  const section1Rows = [
    ["Vendor Name", matter.client_name || "—"],
    ["Co-Vendor", vi?.co_vendor_name || "N/A"],
    ["Vendor Entity", entityLine],
    ["Property Address", matter.address || "—"],
    ["Title Reference", "[Order title search — see Section 5]"],
    ["Purchase Price", priceStr],
    ["Deposit (10%)", depositStr],
    ["Settlement Date", settlement],
    ["Sale Method", vi?.sale_method || "—"],
    ["Possession", vi?.possession_type || "—"],
    [
      "Vendor's Conveyancer",
      "Gitu Kaur, Conveyancing Crew, gitu@conveyancingcrew.com.au",
    ],
    ["Agent", agentLine],
    ["Lender/Mortgage", matter.lender && String(matter.lender).trim() ? matter.lender : "None"],
  ];

  const section3Items = buildSection3Items(vi);
  const prescribed =
    state === "VIC" ? vicPrescribedRows(matter, vi) : nswPrescribedRows(matter, vi);
  const costRows = costTableRows(state);

  const docHeader = new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: "none", size: 0, color: "FFFFFF" },
          bottom: { style: "none", size: 0, color: "FFFFFF" },
          left: { style: "none", size: 0, color: "FFFFFF" },
          right: { style: "none", size: 0, color: "FFFFFF" },
          insideHorizontal: { style: "none", size: 0, color: "FFFFFF" },
          insideVertical: { style: "none", size: 0, color: "FFFFFF" },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "CONVEYANCING CREW",
                        bold: true,
                        size: 18,
                        color: BLUE,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        text: "CONFIDENTIAL — SOLICITOR CLIENT PRIVILEGE",
                        size: 16,
                        color: HEADER_GREY,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const docFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `⚖️ LEGAL DISCLAIMER: This document is a preparation aid only. Gitu Kaur as licensed conveyancer remains fully responsible for the accuracy and completeness of the final contract of sale and all prescribed documents. Conveyancing Crew © ${year}`,
            size: 16,
            color: HEADER_GREY,
            italics: true,
          }),
        ],
      }),
    ],
  });

  const children = [
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: "PAGE 1 — CONTRACT PREPARATION SUMMARY",
          bold: true,
          size: 20,
          color: HEADER_GREY,
        }),
      ],
    }),
    heading("Contract of Sale — Preparation Summary"),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: `${matter.matter_ref} | ${matter.address || ""}`,
          size: 22,
          color: "444444",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Date generated: ${dateStr}`, size: 22 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "Prepared by: Gitu Kaur, Conveyancing Crew",
          size: 22,
        }),
      ],
    }),

    heading("SECTION 1 — CONTRACT FRONT PAGE DATA", 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [3600, 6400],
      rows: [
        new TableRow({
          children: [hdrCell("Label", 36), hdrCell("Value", 64)],
        }),
        ...section1Rows.map(
          ([label, val]) =>
            new TableRow({
              children: [bodyCell(label, 36), bodyCell(val, 64)],
            })
        ),
      ],
    }),

    heading("SECTION 2 — INCLUSIONS & EXCLUSIONS", 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [5000, 5000],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              shading: { fill: GREY_HEADER, type: ShadingType.CLEAR },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Inclusions", bold: true, color: BLUE, size: 22 }),
                  ],
                }),
                ...splitLines(vi?.inclusions).map(
                  (line) =>
                    new Paragraph({
                      children: [new TextRun({ text: `• ${line}`, size: 22 })],
                    })
                ),
              ],
            }),
            new TableCell({
              verticalAlign: VerticalAlign.TOP,
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              shading: { fill: GREY_HEADER, type: ShadingType.CLEAR },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Exclusions", bold: true, color: BLUE, size: 22 }),
                  ],
                }),
                ...splitLines(vi?.exclusions).map(
                  (line) =>
                    new Paragraph({
                      children: [new TextRun({ text: `• ${line}`, size: 22 })],
                    })
                ),
              ],
            }),
          ],
        }),
      ],
    }),

    heading("SECTION 3 — SPECIAL CONDITIONS DRAFT", 2),
    ...section3Items.map(
      (t, i) =>
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: `${i + 1}. ${t}`, size: 22 })],
        })
    ),

    heading("SECTION 4 — PRESCRIBED DOCUMENTS CHECKLIST", 2),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: `Jurisdiction: ${state}`,
          italics: true,
          size: 20,
          color: "555555",
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [2800, 1400, 2600, 2200],
      rows: [
        new TableRow({
          children: [
            hdrCell("Document", 28),
            hdrCell("Required", 14),
            hdrCell("Status", 26),
            hdrCell("Est. Turnaround", 22),
          ],
        }),
        ...prescribed.map(
          (row) =>
            new TableRow({
              children: row.map((cell, idx) =>
                bodyCell(cell, [28, 14, 26, 22][idx])
              ),
            })
        ),
      ],
    }),

    heading("SECTION 5 — SEARCH COST COMPARISON", 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [2600, 1600, 1600, 1400, 2800],
      rows: [
        new TableRow({
          children: [
            hdrCell("Search", 26),
            hdrCell("Gov/Direct Cost", 16),
            hdrCell("triSearch Cost", 16),
            hdrCell("Saving", 14),
            hdrCell("Order Direct", 28),
          ],
        }),
        ...costRows.map(
          (row) =>
            new TableRow({
              children: row.map((cell, idx) =>
                bodyCell(cell, [26, 16, 16, 14, 28][idx])
              ),
            })
        ),
      ],
    }),

    heading("SECTION 6 — VENDOR DETAILS RECORD", 2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [3600, 6400],
      rows: [
        new TableRow({
          children: [hdrCell("Field", 36), hdrCell("Value", 64)],
        }),
        ...vendorRecordRows(vi).map(
          ([label, val]) =>
            new TableRow({
              children: [bodyCell(label, 36), bodyCell(val, 64)],
            })
        ),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
            },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        headers: { default: docHeader },
        footers: { default: docFooter },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const fname = `Contract-Prep-${safeFilenamePart(matterRef)}-${fileDate}.docx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
