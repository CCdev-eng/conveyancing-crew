import { XeroClient } from "xero-node";
import { NextResponse } from "next/server";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { createXeroSupabaseClient } from "@/lib/xero-supabase-admin";

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [
    process.env.XERO_REDIRECT_URI || "http://localhost:3000/api/xero/callback",
  ],
  scopes: "openid profile email offline_access accounting.invoices.read accounting.payments.read accounting.contacts.read accounting.reports.profitandloss.read accounting.reports.executivesummary.read accounting.banktransactions.read".split(" "),
});

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.XERO_REDIRECT_URI_PROD?.replace('/api/xero/callback', '') ||
      'https://conveyancing-crew.vercel.app'
  }
  return 'http://localhost:3000'
}

export async function GET(request) {
  const baseUrl = getBaseUrl()
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

    // Save to file for local dev
    try {
      writeFileSync(
        join(process.cwd(), 'xero-tokens.json'),
        JSON.stringify(tokenData, null, 2)
      );
      console.log('Tokens saved to file');
    } catch(e) {
      console.log('Could not save to file (expected on Vercel):', e.message);
    }

    // Save to Supabase for production (service role bypasses RLS on xero_tokens)
    try {
      const supabase = createXeroSupabaseClient();
      if (!supabase) {
        console.warn("[Xero] Cannot save tokens: missing Supabase URL or key");
      } else {
        const { error } = await supabase.from("xero_tokens").upsert({
          id: 1,
          tenant_id: activeTenantId,
          access_token: tokenSet.access_token,
          refresh_token: tokenSet.refresh_token,
          expires_at: new Date(Date.now() + tokenSet.expires_in * 1000).toISOString(),
        });
        if (error) console.error("[Xero] Supabase upsert error:", error.message, error.code);
        else console.log("Tokens saved to Supabase, tenant:", activeTenantId);
      }
    } catch (e) {
      console.error("Supabase save error:", e.message);
    }

    console.log("Xero connected, redirecting with delay hint for client");
    return NextResponse.redirect(new URL("/?xero=connected&delay=true", request.url));
  } catch (error) {
    console.error('Xero callback error:', error.message || error);
    return Response.redirect(`${baseUrl}?xero=error`);
  }
}