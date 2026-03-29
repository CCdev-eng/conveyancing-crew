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
      !subj.startsWith("✦ contract review:") &&
      !subj.startsWith("⚠ contract review") &&
      !subj.includes("contract review failed") &&
      !subj.includes("contract review issue") &&
      !subj.includes("could not find original")
    );
  });
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

async function sendReviewResultEmail(accessToken, email, documentName, reviewResult) {
  const graphUser = encodeURIComponent(CONTRACTS_MAILBOX);
  const riskColors = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴", CRITICAL: "🚨" };
  const riskIcon = riskColors[reviewResult.overallRiskLevel] || "⚪";

  const redFlagsHtml = (reviewResult.redFlags || [])
    .slice(0, 5)
    .map(
      (f) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          <strong>${f.severity}</strong>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${f.area}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${f.issue}</td>
      </tr>
    `
    )
    .join("");

  const actionsHtml = (reviewResult.recommendedActions || [])
    .slice(0, 5)
    .map((a) => `<li><strong>${a.priority}:</strong> ${a.action}</li>`)
    .join("");

  const emailBody = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;">
      <div style="background:#1a2744;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">✦ Contract Review Complete</h2>
        <p style="margin:4px 0 0;opacity:0.7;font-size:13px;">
          Conveyancing Crew — AI Contract Review
        </p>
      </div>
      <div style="background:white;padding:24px;border:1px solid #ddd;">
        <p style="color:#666;font-size:13px;margin-top:0;">
          Received from: <strong>${email.from?.emailAddress?.name || ""}</strong>
          &lt;${email.from?.emailAddress?.address || ""}&gt;
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr><td style="padding:8px;background:#f8f9fa;font-size:12px;color:#666;width:130px;">DOCUMENT</td><td style="padding:8px;background:#f8f9fa;font-weight:600;">${documentName}</td></tr>
          <tr><td style="padding:8px;font-size:12px;color:#666;">PROPERTY</td><td style="padding:8px;font-weight:600;">${reviewResult.propertyAddress || "See full review"}</td></tr>
          <tr><td style="padding:8px;background:#f8f9fa;font-size:12px;color:#666;">BUYER</td><td style="padding:8px;background:#f8f9fa;font-weight:600;">${reviewResult.buyerName || "—"}</td></tr>
          <tr><td style="padding:8px;font-size:12px;color:#666;">SELLER</td><td style="padding:8px;font-weight:600;">${reviewResult.sellerName || "—"}</td></tr>
          <tr><td style="padding:8px;background:#f8f9fa;font-size:12px;color:#666;">PRICE</td><td style="padding:8px;background:#f8f9fa;font-weight:600;">${reviewResult.purchasePrice || "—"}</td></tr>
          <tr><td style="padding:8px;font-size:12px;color:#666;">DEPOSIT</td><td style="padding:8px;font-weight:600;">${reviewResult.depositAmount || "—"}</td></tr>
          <tr><td style="padding:8px;background:#f8f9fa;font-size:12px;color:#666;">SETTLEMENT</td><td style="padding:8px;background:#f8f9fa;font-weight:600;">${reviewResult.settlementDate || "—"}</td></tr>
          <tr><td style="padding:8px;font-size:12px;color:#666;">COOLING OFF</td><td style="padding:8px;font-weight:600;">${reviewResult.coolingOffPeriod || "—"}</td></tr>
          <tr><td style="padding:8px;background:#f8f9fa;font-size:12px;color:#666;">RISK LEVEL</td><td style="padding:8px;background:#f8f9fa;font-weight:600;font-size:16px;">${riskIcon} ${reviewResult.overallRiskLevel || "—"}</td></tr>
        </table>
        <h3 style="color:#1a2744;border-bottom:2px solid #eee;padding-bottom:8px;">Summary</h3>
        <p style="color:#333;line-height:1.6;">${reviewResult.overallSummary || ""}</p>
        ${
          reviewResult.redFlags?.length > 0
            ? `
          <h3 style="color:#1a2744;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">
            🚨 Red Flags (${reviewResult.redFlags.length} found)
          </h3>
          <table style="width:100%;border-collapse:collapse;">
            <tr style="background:#f8f9fa;">
              <th style="padding:8px;text-align:left;font-size:12px;">SEVERITY</th>
              <th style="padding:8px;text-align:left;font-size:12px;">AREA</th>
              <th style="padding:8px;text-align:left;font-size:12px;">ISSUE</th>
            </tr>
            ${redFlagsHtml}
          </table>`
            : `<p style="color:#16a34a;font-weight:600;">✓ No major red flags found</p>`
        }
        ${
          actionsHtml
            ? `
          <h3 style="color:#1a2744;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">
            Recommended Actions
          </h3>
          <ul style="color:#333;line-height:1.8;">${actionsHtml}</ul>`
            : ""
        }
        ${
          reviewResult.negotiationPoints?.length > 0
            ? `
          <h3 style="color:#1a2744;border-bottom:2px solid #eee;padding-bottom:8px;margin-top:24px;">
            💬 Negotiation Points
          </h3>
          <ul style="color:#333;line-height:1.8;">
            ${reviewResult.negotiationPoints.map((p) => `<li>${p}</li>`).join("")}
          </ul>`
            : ""
        }
        <div style="background:#f0f7ff;border:1px solid #bdd6f5;border-radius:8px;padding:16px;margin-top:24px;">
          <p style="margin:0;font-size:13px;color:#1a2744;">
            <strong>📱 View full review in Conveyancing Crew app</strong><br>
            <span style="color:#666;">
              Log in → Bell icon → Contract Reviews tab →
              Link to existing matter or create new matter
            </span>
          </p>
        </div>
      </div>
      <div style="background:#f8f9fa;padding:12px;text-align:center;font-size:11px;color:#999;border-radius:0 0 8px 8px;">
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
    subject: `✦ Contract Review: ${reviewResult.propertyAddress || documentName} — ${riskIcon} ${reviewResult.overallRiskLevel}`,
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

  console.log("[ContractCron] Result email sent to", GITU_NOTIFY_EMAIL);
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
          .select("id, status")
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
            console.log("[ContractCron] Retrying one failed record:", email.subject);
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

              await supabase
                .from("contract_review_inbox")
                .update({
                  status: "complete",
                  review_result: attResult,
                  is_read: false,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", attRecord.id);

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

          const docLinks = uniqueLinks
            .map((url) => {
              const urlLower = url.toLowerCase();
              let score = 0;
              if (urlLower.includes(".pdf")) score += 25;
              if (urlLower.includes(".docx")) score += 25;
              if (urlLower.includes("contract")) score += 20;
              if (urlLower.includes("document")) score += 15;
              if (urlLower.includes("download")) score += 15;
              if (urlLower.includes("sharepoint")) score += 15;
              if (urlLower.includes("onedrive")) score += 15;
              if (urlLower.includes("dropbox")) score += 15;
              if (urlLower.includes("drive.google")) score += 15;
              if (urlLower.includes("infotrack")) score += 20;
              if (urlLower.includes("pexa")) score += 10;
              if (urlLower.includes("docusign")) score += 15;
              if (urlLower.includes("triconvey")) score += 20;
              if (urlLower.includes("realestate") || urlLower.includes("domain.com")) score += 5;
              if (urlLower.includes(".png") || urlLower.includes(".jpg") || urlLower.includes(".gif"))
                score -= 20;
              if (urlLower.includes("unsubscribe")) score -= 20;
              if (urlLower.includes("logo")) score -= 15;
              if (urlLower.includes("track")) score -= 10;
              if (urlLower.includes("pixel")) score -= 15;
              if (urlLower.includes("microsoft.com/en-us")) score -= 5;
              if (urlLower.includes("privacy")) score -= 10;
              return { url, score };
            })
            .filter((u) => u.score > 0)
            .sort((a, b) => b.score - a.score);

          console.log(
            "[ContractCron] ALL 11 links before scoring:",
            uniqueLinks.map((u) => u.slice(0, 120))
          );

          console.log(
            "[ContractCron] Scored document links:",
            docLinks.slice(0, 5).map((u) => `score:${u.score} ${u.url.slice(0, 100)}`)
          );

          const cleanSubject = String(linkHelpSubject || subject || email.subject || "(no subject)");

          if (docLinks.length === 0) {
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

          for (const { url, score } of docLinks.slice(0, 3)) {
            console.log("[ContractCron] Trying download from:", url.slice(0, 100), "score:", score);

            try {
              const dlRes = await fetch(url, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  Authorization: `Bearer ${accessToken}`,
                },
                redirect: "follow",
              });

              if (!dlRes.ok) {
                console.log("[ContractCron] Download returned:", dlRes.status, "— trying next link");
                continue;
              }

              const contentType = dlRes.headers.get("content-type") || "";
              const arrayBuffer = await dlRes.arrayBuffer();

              if (arrayBuffer.byteLength < 10000) {
                console.log(
                  "[ContractCron] Downloaded file too small:",
                  arrayBuffer.byteLength,
                  "bytes — likely not a contract, trying next"
                );
                continue;
              }

              base64Content = Buffer.from(arrayBuffer).toString("base64");
              docType =
                contentType.includes("wordprocessingml") || url.toLowerCase().includes(".docx")
                  ? "docx"
                  : "pdf";
              try {
                const pathPart = url.split("/").pop()?.split("?")[0] || "";
                documentName =
                  decodeURIComponent(pathPart) ||
                  `contract_${cleanSubject.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.${docType === "docx" ? "docx" : "pdf"}`;
              } catch {
                documentName =
                  docType === "docx"
                    ? "contract.docx"
                    : `contract_${cleanSubject.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.pdf`;
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
              console.log("[ContractCron] Download failed:", dlErr.message, "— trying next link");
            }
          }

          if (!base64Content) {
            await supabase
              .from("contract_review_inbox")
              .update({
                status: "failed",
                error_message:
                  "Found document links but all downloads failed. Links tried: " +
                  docLinks.slice(0, 3).map((u) => u.url.slice(0, 80)).join(", "),
                updated_at: new Date().toISOString(),
              })
              .eq("id", inboxRecord.id);

            await sendFailureEmail(
              accessToken,
              `Could not download contract — ${email.subject}`,
              `Found document links in the email chain but could not download them.\n\n` +
                `Links tried:\n${docLinks.slice(0, 3).map((u) => u.url.slice(0, 150)).join("\n")}\n\n` +
                `These links may require a login. Please download the contract manually ` +
                `and forward as an email attachment to contractreview@conveyancingcrew.com.au`
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

        await supabase
          .from("contract_review_inbox")
          .update({
            status: "complete",
            review_result: reviewResult,
            is_read: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inboxRecord.id);

        await sendReviewResultEmail(accessToken, email, documentName, reviewResult);

        results.processed++;
        console.log("[ContractCron] ✓ Completed:", email.subject);
      } catch (err) {
        console.error("[ContractCron] Failed for:", email.subject, "|", err.message);
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
