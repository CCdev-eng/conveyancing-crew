import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

const FROM_BLOCK_SUBSTRINGS = [
  "conveyancingcrew.com.au",
  "microsoft.com",
  "noreply",
  "no-reply",
  "donotreply",
  "mailer",
  "newsletter",
];

const SUBJECT_BLOCK_SUBSTRINGS = [
  "unsubscribe",
  "newsletter",
  "notification",
  "alert",
  "receipt",
  "invoice",
];

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSkipByHeuristics(fromAddress, subject) {
  const from = (fromAddress || "").toLowerCase();
  const subj = (subject || "").toLowerCase();
  for (const s of FROM_BLOCK_SUBSTRINGS) {
    if (from.includes(s)) return { skip: true, reason: `from contains ${s}` };
  }
  for (const s of SUBJECT_BLOCK_SUBSTRINGS) {
    if (subj.includes(s)) return { skip: true, reason: `subject contains ${s}` };
  }
  return { skip: false };
}

function parseClassificationJson(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function getGraphToken() {
  const tenant = process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID;
  const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    return { error: "Missing Microsoft OAuth env (tenant, client id, or secret)" };
  }
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
      tenant,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return { error: "Failed to get Graph token", details: tokenData };
  }
  return { accessToken: tokenData.access_token };
}

async function markEmailRead(accessToken, mailboxEnc, messageId) {
  try {
    await fetch(`https://graph.microsoft.com/v1.0/users/${mailboxEnc}/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isRead: true }),
    });
  } catch (err) {
    console.error("[EnquiryCron] Could not mark email as read:", err.message);
  }
}

async function nextMatterRef(supabase, year) {
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
  const next = maxN + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[EnquiryCron] Missing Supabase URL or service role key");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const mailbox = process.env.MICROSOFT_MAILBOX_EMAIL?.trim();
  if (!mailbox) {
    console.error("[EnquiryCron] MICROSOFT_MAILBOX_EMAIL is not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[EnquiryCron] ANTHROPIC_API_KEY is not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const tokenOut = await getGraphToken();
  if (tokenOut.error) {
    console.error("[EnquiryCron]", tokenOut.error, tokenOut.details || "");
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
  const { accessToken } = tokenOut;
  const graphMailbox = encodeURIComponent(mailbox);

  let processed = 0;
  let draftsCreated = 0;
  let skipped = 0;

  try {
    const listUrl =
      `https://graph.microsoft.com/v1.0/users/${graphMailbox}/messages` +
      `?$filter=${encodeURIComponent("isRead eq false")}` +
      `&$orderby=receivedDateTime desc` +
      `&$top=20` +
      `&$select=id,subject,from,receivedDateTime,bodyPreview,body`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listData = await listRes.json();
    if (listData.error) {
      console.error("[EnquiryCron] Graph list error:", listData.error);
      return NextResponse.json(
        { error: listData.error.message || "Graph list failed" },
        { status: 500 },
      );
    }

    const summaries = listData.value || [];
    console.log("[EnquiryCron] Unread messages:", summaries.length);

    for (const summary of summaries) {
      const messageId = summary.id;
      if (!messageId) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from("enquiry_inbox")
        .select("id")
        .eq("email_id", messageId)
        .maybeSingle();

      if (existing?.id) {
        console.log("[EnquiryCron] Skip — already in enquiry_inbox:", summary.subject);
        skipped++;
        continue;
      }

      const fromEmail = summary.from?.emailAddress?.address || "";
      const fromName = summary.from?.emailAddress?.name || "";
      const subject = summary.subject || "";

      const noise = shouldSkipByHeuristics(fromEmail, subject);
      if (noise.skip) {
        console.log("[EnquiryCron] Skip — noise:", noise.reason, "|", subject);
        skipped++;
        continue;
      }

      const fullRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${graphMailbox}/messages/${messageId}` +
          `?$select=id,subject,from,body,receivedDateTime`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const full = await fullRes.json();
      if (full.error || !full.id) {
        console.error("[EnquiryCron] Full message fetch failed:", full.error || messageId);
        skipped++;
        continue;
      }

      const bodyHtml = full.body?.content || summary.body?.content || "";
      const bodyPreview = stripHtml(bodyHtml).slice(0, 500);

      const userPrompt =
        `Classify this email and extract any client details.\n\n` +
        `From: ${fromName} <${fromEmail}>\n` +
        `Subject: ${subject}\n` +
        `Body: ${bodyPreview}\n\n` +
        `Respond with this exact JSON structure:\n` +
        `{\n` +
        `  "is_enquiry": true/false,\n` +
        `  "confidence": 0-100,\n` +
        `  "matter_type": "Purchase" | "Sale" | "Lease" | "Contract Review" | "General Enquiry",\n` +
        `  "client_name": "extracted name or null",\n` +
        `  "client_email": "extracted email or null",\n` +
        `  "client_phone": "extracted phone or null",\n` +
        `  "address": "extracted property address or null",\n` +
        `  "notes": "brief reason for classification"\n` +
        `}\n\n` +
        `is_enquiry = true only if this looks like a genuine new client reaching out for conveyancing help.\n` +
        `Set false for: agent emails, solicitor correspondence, newsletters, spam, internal emails, contract documents.`;

      let classification;
      try {
        const aiRes = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          system:
            "You are an assistant for an Australian conveyancing practice. Classify incoming emails and extract details. Respond ONLY with valid JSON, no other text.",
          messages: [{ role: "user", content: userPrompt }],
        });
        const textOut = (aiRes.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        classification = parseClassificationJson(textOut);
      } catch (e) {
        console.error("[EnquiryCron] Claude error:", e.message);
        skipped++;
        continue;
      }

      if (!classification) {
        console.log("[EnquiryCron] Unparseable classification:", summary.subject);
        skipped++;
        continue;
      }

      processed++;

      const isEnquiry = Boolean(classification.is_enquiry);
      const confidence = Number(classification.confidence);
      const confOk = Number.isFinite(confidence) && confidence >= 70;

      if (!isEnquiry || !confOk) {
        const { error: insSkipErr } = await supabase.from("enquiry_inbox").insert({
          email_id: messageId,
          from_email: fromEmail || null,
          from_name: fromName || null,
          subject,
          received_at: full.receivedDateTime || summary.receivedDateTime,
          classification,
          status: "skipped",
        });
        if (insSkipErr) {
          console.error("[EnquiryCron] enquiry_inbox skip insert failed:", insSkipErr);
        }
        skipped++;
        continue;
      }

      let matterRef;
      try {
        matterRef = await nextMatterRef(supabase, new Date().getFullYear());
      } catch (e) {
        console.error("[EnquiryCron] matter_ref generation failed:", e.message);
        skipped++;
        continue;
      }

      const matterType = classification.matter_type || "General Enquiry";
      const clientName =
        (classification.client_name && String(classification.client_name).trim()) || fromName || "New Client";
      const clientEmail =
        (classification.client_email && String(classification.client_email).trim()) || fromEmail || null;
      const clientPhone =
        classification.client_phone != null && String(classification.client_phone).trim()
          ? String(classification.client_phone).trim()
          : null;
      const address =
        classification.address != null && String(classification.address).trim()
          ? String(classification.address).trim()
          : null;

      const openedDate = new Date().toISOString().slice(0, 10);

      const { error: inboxErr } = await supabase.from("enquiry_inbox").upsert(
        {
          email_id: messageId,
          from_email: fromEmail || null,
          from_name: fromName || null,
          subject,
          received_at: full.receivedDateTime || summary.receivedDateTime,
          classification,
          status: "pending_review",
        },
        { onConflict: "email_id" },
      );

      if (inboxErr) {
        console.error("[EnquiryCron] enquiry_inbox upsert failed:", inboxErr);
        skipped++;
        continue;
      }

      const matterRow = {
        matter_ref: matterRef,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        address: address || "",
        type: matterType,
        matter_status: "draft",
        source_email_id: messageId,
        draft_extracted: classification,
        opened_date: openedDate,
        state: "NSW",
        stage: "Intake",
        status: "active",
        urgency: "medium",
        staff: "enquiry-inbox-cron",
        notes: JSON.stringify({ source: "enquiry_inbox_cron", notes: classification.notes || "" }),
      };

      let { error: matterErr } = await supabase.from("matters").insert(matterRow);
      if (matterErr) {
        const { matter_status: _m, source_email_id: _s, draft_extracted: _d, ...fallback } = matterRow;
        const r2 = await supabase.from("matters").insert(fallback);
        matterErr = r2.error;
      }

      if (matterErr) {
        console.error("[EnquiryCron] matters insert failed:", matterErr);
        await supabase.from("enquiry_inbox").delete().eq("email_id", messageId);
        skipped++;
        continue;
      }

      await markEmailRead(accessToken, graphMailbox, messageId);
      draftsCreated++;
      console.log("[EnquiryCron] Draft matter created:", matterRef, "|", subject);
    }

    return NextResponse.json({
      success: true,
      processed,
      drafts_created: draftsCreated,
      skipped,
    });
  } catch (err) {
    console.error("[EnquiryCron] Fatal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
