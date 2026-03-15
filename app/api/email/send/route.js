/**
 * POST /api/email/send
 * Body: { to, subject, body, matterId }
 * Sends email via Microsoft Graph (mailbox from MICROSOFT_MAILBOX_EMAIL for app-only auth).
 */
const tenantId = process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID;
const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const mailbox = process.env.MICROSOFT_MAILBOX_EMAIL;

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

export async function POST(request) {
  try {
    const { to, subject, body, matterId } = await request.json();

    if (!to || !subject) {
      return Response.json(
        { error: "to and subject are required" },
        { status: 400 }
      );
    }

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
    const url = `${baseUrl}/sendMail`;

    const payload = {
      message: {
        subject: subject || "(No subject)",
        body: {
          contentType: "HTML",
          content: body ? body.replace(/\n/g, "<br>") : "",
        },
        toRecipients: Array.isArray(to)
          ? to.map((e) => ({ emailAddress: { address: typeof e === "string" ? e : e.address } }))
          : [{ emailAddress: { address: to } }],
      },
    };

    const graphRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!graphRes.ok) {
      const err = await graphRes.text();
      console.error("Graph sendMail error:", graphRes.status, err);
      return Response.json(
        { error: "Failed to send email via Microsoft Graph" },
        { status: graphRes.status }
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("POST /api/email/send error:", err);
    return Response.json(
      { error: err.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
