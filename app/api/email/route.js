/**
 * GET /api/email?address=...  or  ?query=...
 * Single Microsoft Graph search using the full property address (or optional query).
 * GET .../messages?$search="{fullAddress}"&$top=20
 */
const tenantId = process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID;
const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const mailbox = process.env.MICROSOFT_MAILBOX_EMAIL;

function getAddressPhrase(address) {
  if (!address || typeof address !== "string") return "";
  return address.trim();
}

async function getAccessToken() {
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
    throw new Error(`Token error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

function mapMessages(data) {
  return (data.value || []).map((m) => ({
    id: m.id,
    subject: m.subject,
    bodyPreview: m.bodyPreview,
    receivedDateTime: m.receivedDateTime,
    isRead: m.isRead,
    from: m.from?.emailAddress
      ? { name: m.from.emailAddress.name, address: m.from.emailAddress.address }
      : null,
    toRecipients: (m.toRecipients || []).map((r) => ({
      name: r.emailAddress?.name,
      address: r.emailAddress?.address,
    })),
  }));
}

function mapSingleMessageWithBody(m) {
  return {
    id: m.id,
    subject: m.subject,
    bodyPreview: m.bodyPreview,
    body: m.body?.content ?? null,
    bodyContentType: m.body?.contentType ?? "text",
    receivedDateTime: m.receivedDateTime,
    isRead: m.isRead,
    from: m.from?.emailAddress
      ? { name: m.from.emailAddress.name, address: m.from.emailAddress.address }
      : null,
    toRecipients: (m.toRecipients || []).map((r) => ({
      name: r.emailAddress?.name,
      address: r.emailAddress?.address,
    })),
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const emailId = searchParams.get("emailId");
    const query = searchParams.get("query");
    const address = searchParams.get("address");

    if (!tenantId || !clientId || !clientSecret) {
      return Response.json(
        { error: "Microsoft OAuth env vars not configured" },
        { status: 500 }
      );
    }

    const token = await getAccessToken();
    const baseUrl = mailbox
      ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`
      : "https://graph.microsoft.com/v1.0/me";
    const headers = { Authorization: `Bearer ${token}` };

    if (emailId && emailId.trim()) {
      const select = "id,subject,from,receivedDateTime,body,isRead,toRecipients";
      const url = `${baseUrl}/messages/${encodeURIComponent(emailId.trim())}?$select=${encodeURIComponent(select)}`;
      console.log("[email] fetch single message:", emailId);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error("[email] Graph single message status:", res.status);
        return Response.json({ error: "Email not found" }, { status: 404 });
      }
      const m = await res.json();
      const email = mapSingleMessageWithBody(m);
      const mailboxLower = (mailbox || "").toLowerCase();
      email.isOutgoing = !!mailboxLower && (email.from?.address || "").toLowerCase() === mailboxLower;
      return Response.json(email);
    }

    const searchTerm = (query && query.trim()) || getAddressPhrase(address || "");
    if (!searchTerm) {
      return Response.json([]);
    }

    const select = "id,subject,from,receivedDateTime,bodyPreview,isRead,toRecipients";
    const params = new URLSearchParams();
    params.set("$search", `"${searchTerm.replace(/"/g, '\\"')}"`);
    params.set("$top", "20");
    params.set("$select", select);
    const url = `${baseUrl}/messages?${params.toString()}`;

    console.log("[email] search (address only):", searchTerm);
    const res = await fetch(url, { headers });
    const data = res.ok ? await res.json() : null;

    if (!res.ok) {
      console.error("[email] Graph status:", res.status);
      return Response.json([]);
    }

    const emails = mapMessages(data || { value: [] });
    const mailboxLower = (mailbox || "").toLowerCase();
    emails.forEach((e) => {
      e.isOutgoing = !!mailboxLower && (e.from?.address || "").toLowerCase() === mailboxLower;
    });
    emails.sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime));
    console.log("[email] results:", emails.length);
    return Response.json(emails);
  } catch (err) {
    console.error("GET /api/email error:", err);
    return Response.json(
      { error: err.message || "Failed to fetch emails" },
      { status: 500 }
    );
  }
}
