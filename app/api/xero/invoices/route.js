import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { createXeroSupabaseClient } from "@/lib/xero-supabase-admin";

/** Module cache — must appear before route exports */
let cachedXeroData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Vercel: many sequential P&L calls need headroom */
export const maxDuration = 120;

async function getValidToken() {
  // Try file first (local dev)
  try {
    const tokenPath = join(process.cwd(), 'xero-tokens.json');
    if (existsSync(tokenPath)) {
      const tokenData = JSON.parse(readFileSync(tokenPath, 'utf8'));
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();
      if (expiresAt - now > 5 * 60 * 1000) {
        return tokenData;
      }
      // Try refresh
      const refreshed = await refreshToken(tokenData);
      if (refreshed) {
        try {
          writeFileSync(tokenPath, JSON.stringify(refreshed, null, 2));
        } catch(e) {}
        return refreshed;
      }
      try {
        unlinkSync(tokenPath);
        console.warn(
          "[Xero] Removed xero-tokens.json after failed refresh. Re-authorize: GET /api/xero/auth"
        );
      } catch (_) {}
    }
  } catch(e) {}

  // Try Supabase (production / shared store)
  try {
    const supabase = createXeroSupabaseClient();
    if (!supabase) {
      console.warn("[Xero] Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key for token store");
    } else {
      const { data, error: readErr } = await supabase
        .from("xero_tokens")
        .select("*")
        .eq("id", 1)
        .single();
      if (readErr) {
        console.error("[Xero] xero_tokens read error:", readErr.message, readErr.code);
      }
      if (data) {
        const expiresAt = new Date(data.expires_at);
        const now = new Date();
        if (expiresAt - now > 5 * 60 * 1000) {
          return {
            tenant_id: data.tenant_id,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at,
          };
        }
        let refreshed;
        try {
          refreshed = await refreshToken({
            tenant_id: data.tenant_id,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at,
          });
        } catch (e) {
          console.error("[Xero] Supabase token refresh failed:", e?.message || e);
          refreshed = null;
        }
        if (refreshed) {
          await supabase.from("xero_tokens").upsert({
            id: 1,
            tenant_id: refreshed.tenant_id,
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
            expires_at: refreshed.expires_at,
          });
          return refreshed;
        }
      }
    }
  } catch (e) {
    console.error("[Xero] Supabase token fetch error:", e.message);
  }

  return null;
}

async function refreshToken(tokens) {
  if (!tokens?.refresh_token) {
    console.warn("[Xero] refreshToken: missing refresh_token");
    throw new Error("Token refresh failed: no refresh_token");
  }
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[Xero] Missing XERO_CLIENT_ID or XERO_CLIENT_SECRET");
    throw new Error("Token refresh failed: OAuth env not configured");
  }

  console.log("[Xero] Attempting token refresh...");
  const tokenResponse = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(clientId + ":" + clientSecret).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  const refreshData = await tokenResponse.json().catch(() => ({}));
  console.log("[Xero] Refresh response status:", tokenResponse.status);
  console.log("[Xero] Refresh response:", JSON.stringify(refreshData).slice(0, 200));

  if (!tokenResponse.ok || refreshData.error) {
    console.error(
      "[Xero] Token refresh failed:",
      refreshData.error,
      refreshData.error_description
    );
    if (String(refreshData.error_description || "").includes("invalid_grant") || refreshData.error === "invalid_grant") {
      console.error(
        "[Xero] Refresh token is invalid or revoked. Open /api/xero/auth in the browser to connect again."
      );
    }
    throw new Error(
      "Token refresh failed: " + (refreshData.error_description || refreshData.error || `HTTP ${tokenResponse.status}`)
    );
  }

  if (!refreshData.access_token) {
    console.error("[Xero] Token refresh missing access_token in body");
    throw new Error("Token refresh failed: no access_token in response");
  }

  const expiresInSec = Number(refreshData.expires_in) || 1800;
  const newTokens = {
    ...tokens,
    access_token: refreshData.access_token,
    refresh_token: refreshData.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };

  console.log("[Xero] Token refreshed successfully, waiting before API calls");
  globalThis.xeroLastRefresh = Date.now();
  return newTokens;
}

const PL_MIN_GAP_MS = 1200; // 1.2 seconds between calls

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitIfRecentlyRefreshed() {
  const timeSinceRefresh = Date.now() - (globalThis.xeroLastRefresh || 0);
  if (timeSinceRefresh < 30000) {
    const waitMs = 30000 - timeSinceRefresh;
    console.log("[Xero] Recently refreshed, waiting", Math.round(waitMs / 1000), "seconds...");
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Xero rate-limits P&L calls (429). Do not retry — caller returns cache or error.
 */
async function fetchPL(headers, fromDate, toDate) {
  try {
    await waitIfRecentlyRefreshed();
    const res = await fetch(
      `https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDate}`,
      { headers }
    );
    if (res.status === 429) {
      await res.text().catch(() => "");
      console.log("[Xero] Rate limited by Xero API — not retrying");
      return { rateLimited: true, report: null };
    }
    if (!res.ok) {
      const snippet = await res.text().catch(() => "");
      console.error("[Xero] P&L API", res.status, fromDate, toDate, snippet.slice(0, 200));
      return { rateLimited: false, report: null };
    }
    const text = await res.text();
    if (!text) return { rateLimited: false, report: null };
    const report = JSON.parse(text)?.Reports?.[0] || null;
    return { rateLimited: false, report };
  } catch (e) {
    console.error("[Xero] fetchPL error:", e.message || e);
    return { rateLimited: false, report: null };
  }
}

/** YYYY-MM-DD using local calendar fields (Node/browser TZ). Avoids UTC day-shift from toISOString(). */
function toYmdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function jsonRateLimitedResponse() {
  if (cachedXeroData) {
    console.log("[Xero] Returning stale cached data due to rate limit");
    return NextResponse.json(cachedXeroData);
  }
  console.log("[Xero] Rate limited by Xero API");
  return NextResponse.json(
    {
      error: "rate_limited",
      message: "Xero API rate limit reached",
    },
    { status: 429 }
  );
}

function parsePL(report) {
  if (!report) return { income: 0, expenses: 0, profit: 0 };
  const rows = report.Rows || [];
  const incomeSection =
    rows.find((r) => r.RowType === "Section" && r.Title === "Income") ||
    rows.find((r) => r.Title === "Income");
  const expSection =
    rows.find(
      (r) => r.RowType === "Section" && (r.Title || "").toLowerCase().includes("expense")
    ) || rows.find((r) => (r.Title || "").includes("Expenses"));
  const income = parseFloat(
    incomeSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value || 0
  );
  const expenses = parseFloat(
    expSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value || 0
  );
  return { income, expenses, profit: income - expenses };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "monthly";

    const today = new Date();
    const todayStr = toYmdLocal(today);

    const now = Date.now();
    if (cachedXeroData && now - cacheTimestamp < CACHE_TTL) {
      console.log("[Xero] Cache hit, age:", Math.round((now - cacheTimestamp) / 1000), "sec");
      return NextResponse.json(cachedXeroData);
    }

    const tokenData = await getValidToken();
    if (!tokenData) {
      return Response.json(
        { error: 'Not connected to Xero' },
        {
          status: 401,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
          },
        }
      );
    }

    const tenantId = tokenData.tenant_id;
    const headers = {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Xero-tenant-id': tenantId,
      'Accept': 'application/json'
    };

    // Current month
    const currentMonthFrom = toYmdLocal(new Date(today.getFullYear(), today.getMonth(), 1));

    // Current quarter
    const currentQuarterMonth = Math.floor(today.getMonth() / 3) * 3;
    const currentQuarterFrom = toYmdLocal(new Date(today.getFullYear(), currentQuarterMonth, 1));

    // Australian financial year
    const fyYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    const fyFrom = `${fyYear}-07-01`;

    let currentMonthReport;
    let currentQuarterReport;
    let fyReport;

    {
      const r1 = await fetchPL(headers, currentMonthFrom, todayStr);
      if (r1.rateLimited) return jsonRateLimitedResponse();
      currentMonthReport = r1.report;
      await sleep(PL_MIN_GAP_MS);
      const r2 = await fetchPL(headers, currentQuarterFrom, todayStr);
      if (r2.rateLimited) return jsonRateLimitedResponse();
      currentQuarterReport = r2.report;
      await sleep(PL_MIN_GAP_MS);
      const r3 = await fetchPL(headers, fyFrom, todayStr);
      if (r3.rateLimited) return jsonRateLimitedResponse();
      fyReport = r3.report;
    }

    const currentMonth = { ...parsePL(currentMonthReport), from: currentMonthFrom, to: todayStr };
    const currentQuarter = { ...parsePL(currentQuarterReport), from: currentQuarterFrom, to: todayStr };
    const financialYear = { ...parsePL(fyReport), from: fyFrom, to: todayStr };

    // Fetch chart data based on period (skipped on minimal load — reduces P&L calls from 16+ to 3)
    let chartData = [];

    if (searchParams.get("minimal") !== "true") {
      if (period === 'monthly') {
        const indices = Array.from({ length: 12 }, (_, k) => 11 - k);
        const monthlyResults = [];
        for (const i of indices) {
          const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const from = toYmdLocal(new Date(d.getFullYear(), d.getMonth(), 1));
          const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          const to = toYmdLocal(lastDay);
          const label = d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
          const pl = await fetchPL(headers, from, to);
          if (pl.rateLimited) return jsonRateLimitedResponse();
          const report = pl.report;
          const parsed = parsePL(report);
          monthlyResults.push({ month: label, from, to, ...parsed, report, _order: i });
          await sleep(PL_MIN_GAP_MS);
        }
        monthlyResults.sort((a, b) => b._order - a._order);
        chartData = monthlyResults.map(({ _order, ...rest }) => rest);
      } else if (period === 'quarterly') {
        for (let i = 3; i >= 0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth() - i * 3, 1);
          const quarterStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
          const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
          const from = toYmdLocal(quarterStart);
          const to = quarterEnd > today ? todayStr : toYmdLocal(quarterEnd);
          const label = `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()}`;
          const pl = await fetchPL(headers, from, to);
          if (pl.rateLimited) return jsonRateLimitedResponse();
          const report = pl.report;
          const parsed = parsePL(report);
          chartData.push({ month: label, from, to, ...parsed, report });
          await sleep(PL_MIN_GAP_MS);
        }
      } else if (period === 'yearly') {
        for (let i = 2; i >= 0; i--) {
          const fy = today.getMonth() >= 6 ? today.getFullYear() - i : today.getFullYear() - i - 1;
          const from = `${fy}-07-01`;
          const to = i === 0 ? todayStr : `${fy + 1}-06-30`;
          const label = `FY${String(fy + 1).slice(2)}`;
          const pl = await fetchPL(headers, from, to);
          if (pl.rateLimited) return jsonRateLimitedResponse();
          const report = pl.report;
          const parsed = parsePL(report);
          chartData.push({ month: label, from, to, ...parsed, report });
          await sleep(PL_MIN_GAP_MS);
        }
      }
    }

    // Get breakdown rows for pie charts based on period
    const breakdownReport = period === 'monthly' ? currentMonthReport :
      period === 'quarterly' ? currentQuarterReport : fyReport;
    const breakdownRows = breakdownReport?.Rows || [];
    const incomeSectionBr =
      breakdownRows.find((r) => r.RowType === "Section" && r.Title === "Income") ||
      breakdownRows.find((r) => r.Title === "Income");
    const incomeRows = incomeSectionBr?.Rows?.filter((r) => r.RowType === "Row") || [];
    const expenseSectionBr =
      breakdownRows.find(
        (r) => r.RowType === "Section" && (r.Title || "").toLowerCase().includes("expense")
      ) || breakdownRows.find((r) => (r.Title || "").includes("Expenses"));
    const expenseRows = expenseSectionBr?.Rows?.filter((r) => r.RowType === "Row") || [];

    // Chart totals
    const chartTotals = {
      income: chartData.reduce((s, m) => s + (m.income || 0), 0),
      expenses: chartData.reduce((s, m) => s + (m.expenses || 0), 0),
      profit: chartData.reduce((s, m) => s + (m.profit || 0), 0)
    };

    const result = {
      period,
      chartData,
      currentMonth,
      currentQuarter,
      financialYear,
      chartTotals,
      incomeRows,
      expenseRows,
      breakdownPeriod: {
        fromDate: period === 'monthly' ? currentMonthFrom :
          period === 'quarterly' ? currentQuarterFrom : fyFrom,
        toDate: todayStr
      },
      summary: {
        fromDate: fyFrom,
        toDate: todayStr,
        tenantName: 'Conveyancing Crew'
      }
    };

    if (searchParams.get("minimal") !== "true") {
      cachedXeroData = result;
      cacheTimestamp = Date.now();
      console.log("[Xero] Data cached");
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });

  } catch (error) {
    console.error('Xero data error:', error.message || error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}