import { XeroClient } from "xero-node";

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [
    process.env.XERO_REDIRECT_URI || "http://localhost:3000/api/xero/callback",
  ],
  scopes: "openid profile email offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read accounting.reports.profitandloss.read accounting.reports.executivesummary.read accounting.banktransactions.read".split(" "),
});

export async function GET() {
  const consentUrl = await xero.buildConsentUrl();
  console.log('Xero consent URL:', consentUrl);
  return Response.redirect(consentUrl);
}