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

    const plainBody = (body || "").split("--")[0].trim();
    const htmlEmail = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:13px;line-height:1.8;color:#333;max-width:600px">
<div style="margin-bottom:20px">${plainBody.replace(/\n/g, "<br/>")}</div>
<div style="border-top:2px solid #245eb0;padding-top:12px;margin-top:12px">
<div style="font-weight:700;font-size:14px;color:#0d0f1a">Gitu Kaur</div>
<div style="color:#555">Conveyancing Crew, Conveyancer/Director</div>
<div><img src="https://mhdyxhxybcbowhcszxct.supabase.co/storage/v1/object/public/public-assets/logo-jpg%20new.jpg" alt="Conveyancing Crew" style="height:50px;margin:8px 0;display:block"/></div>
<div style="color:#555">+61422387113</div>
<div style="color:#555">PO Box 6621, Baulkham Hills, NSW 2153</div>
<div><a href="https://conveyancingcrew.com.au" style="color:#245eb0;text-decoration:none">https://conveyancingcrew.com.au</a></div>
</div>
<div style="margin-top:16px;padding:10px 12px;background:#eef3fb;border-left:3px solid #245eb0;font-size:11px;color:#555;line-height:1.6">
<strong>FRAUD WARNING:</strong> There has been a recent increase in the number of attempted fraud cases relating to the transfer of money. Please ensure that you DO NOT deposit money to an account nominated by CONVEYANCING CREW UNLESS you have first telephoned us on a known or separately verified number to verify the account number by phone. We will not accept responsibility if you transfer money into an incorrect account not provided by us and without first verifying the account details with us.
</div>
</body></html>`;

    const toRecipients = Array.isArray(to)
      ? to.map((e) => ({ emailAddress: { address: typeof e === "string" ? e : e.address } }))
      : [{ emailAddress: { address: to } }];

    const payload = {
      message: {
        subject: subject || "(No subject)",
        body: {
          contentType: "HTML",
          content: htmlEmail,
        },
        toRecipients,
      },
      saveToSentItems: true,
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
