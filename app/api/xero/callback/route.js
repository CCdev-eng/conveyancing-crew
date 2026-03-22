import { XeroClient } from "xero-node";
import { writeFileSync } from "fs";
import { join } from "path";

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [
    process.env.XERO_REDIRECT_URI || "http://localhost:3000/api/xero/callback",
  ],
  scopes: "openid profile email offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read accounting.reports.profitandloss.read accounting.reports.executivesummary.read accounting.banktransactions.read".split(" "),
});

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const tokenSet = await xero.apiCallback(url.toString());

    const connectionsRes = await fetch('https://api.xero.com/connections', {
      headers: {
        'Authorization': `Bearer ${tokenSet.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    const connections = await connectionsRes.json();
    const activeTenantId = connections[0]?.tenantId;

    const tokenData = {
      tenant_id: activeTenantId,
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: new Date(Date.now() + (tokenSet.expires_in * 1000)).toISOString(),
      scopes: tokenSet.scope
    };

    writeFileSync(
      join(process.cwd(), 'xero-tokens.json'),
      JSON.stringify(tokenData, null, 2)
    );

    console.log('Tokens saved, tenant:', activeTenantId);
    console.log('Scopes granted:', tokenSet.scope);

    return Response.redirect('http://localhost:3000?xero=connected');
  } catch (error) {
    console.error('Xero callback error:', error.message || error);
    return Response.redirect('http://localhost:3000?xero=error');
  }
}