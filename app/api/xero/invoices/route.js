import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

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
    }
  } catch(e) {}

  // Try Supabase (production)
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (data) {
      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      if (expiresAt - now > 5 * 60 * 1000) {
        return {
          tenant_id: data.tenant_id,
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at
        };
      }
      // Try refresh
      const refreshed = await refreshToken(data);
      if (refreshed) {
        await supabase.from('xero_tokens').upsert({
          id: 1,
          tenant_id: refreshed.tenant_id,
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expires_at: refreshed.expires_at
        });
        return refreshed;
      }
    }
  } catch(e) {
    console.log('Supabase token fetch error:', e.message);
  }

  return null;
}

async function refreshToken(tokenData) {
  if (!tokenData.refresh_token) return null;
  try {
    const credentials = Buffer.from(
      process.env.XERO_CLIENT_ID + ':' + process.env.XERO_CLIENT_SECRET
    ).toString('base64');
    const res = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + credentials,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token
      })
    });
    if (!res.ok) return null;
    const newTokenSet = await res.json();
    return {
      tenant_id: tokenData.tenant_id,
      access_token: newTokenSet.access_token,
      refresh_token: newTokenSet.refresh_token || tokenData.refresh_token,
      expires_at: new Date(Date.now() + (newTokenSet.expires_in * 1000)).toISOString()
    };
  } catch(e) {
    return null;
  }
}

async function fetchPL(headers, fromDate, toDate) {
  try {
    const res = await fetch(
      `https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDate}`,
      { headers }
    );
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text)?.Reports?.[0] || null;
  } catch(e) { return null; }
}

function parsePL(report) {
  if (!report) return { income: 0, expenses: 0, profit: 0 };
  const rows = report.Rows || [];
  const incomeSection = rows.find(r => r.Title === 'Income');
  const expSection = rows.find(r => r.Title?.includes('Expenses'));
  const income = parseFloat(
    incomeSection?.Rows?.find(r => r.RowType === 'SummaryRow')?.Cells?.[1]?.Value || 0
  );
  const expenses = parseFloat(
    expSection?.Rows?.find(r => r.RowType === 'SummaryRow')?.Cells?.[1]?.Value || 0
  );
  return { income, expenses, profit: income - expenses };
}

export async function GET(request) {
  try {
    const tokenData = await getValidToken();
    if (!tokenData) {
      return Response.json({ error: 'Not connected to Xero' }, { status: 401 });
    }

    const tenantId = tokenData.tenant_id;
    const headers = {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Xero-tenant-id': tenantId,
      'Accept': 'application/json'
    };

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'monthly';

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Current month
    const currentMonthFrom = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().split('T')[0];

    // Current quarter
    const currentQuarterMonth = Math.floor(today.getMonth() / 3) * 3;
    const currentQuarterFrom = new Date(today.getFullYear(), currentQuarterMonth, 1)
      .toISOString().split('T')[0];

    // Australian financial year
    const fyYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    const fyFrom = `${fyYear}-07-01`;

    // Fetch current period reports in parallel
    const [currentMonthReport, currentQuarterReport, fyReport] = await Promise.all([
      fetchPL(headers, currentMonthFrom, todayStr),
      fetchPL(headers, currentQuarterFrom, todayStr),
      fetchPL(headers, fyFrom, todayStr)
    ]);

    const currentMonth = { ...parsePL(currentMonthReport), from: currentMonthFrom, to: todayStr };
    const currentQuarter = { ...parsePL(currentQuarterReport), from: currentQuarterFrom, to: todayStr };
    const financialYear = { ...parsePL(fyReport), from: fyFrom, to: todayStr };

    // Fetch chart data based on period
    let chartData = [];

    if (period === 'monthly') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const to = lastDay.toISOString().split('T')[0];
        const label = d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
        const report = await fetchPL(headers, from, to);
        const parsed = parsePL(report);
        chartData.push({ month: label, from, to, ...parsed, report });
        await new Promise(r => setTimeout(r, 100));
      }
    } else if (period === 'quarterly') {
      for (let i = 3; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - (i * 3), 1);
        const quarterStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
        const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
        const from = quarterStart.toISOString().split('T')[0];
        const to = quarterEnd > today ? todayStr : quarterEnd.toISOString().split('T')[0];
        const label = `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()}`;
        const report = await fetchPL(headers, from, to);
        const parsed = parsePL(report);
        chartData.push({ month: label, from, to, ...parsed, report });
        await new Promise(r => setTimeout(r, 100));
      }
    } else if (period === 'yearly') {
      for (let i = 2; i >= 0; i--) {
        const fy = today.getMonth() >= 6 ? today.getFullYear() - i : today.getFullYear() - i - 1;
        const from = `${fy}-07-01`;
        const to = i === 0 ? todayStr : `${fy + 1}-06-30`;
        const label = `FY${String(fy + 1).slice(2)}`;
        const report = await fetchPL(headers, from, to);
        const parsed = parsePL(report);
        chartData.push({ month: label, from, to, ...parsed, report });
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Get breakdown rows for pie charts based on period
    const breakdownReport = period === 'monthly' ? currentMonthReport :
      period === 'quarterly' ? currentQuarterReport : fyReport;
    const breakdownRows = breakdownReport?.Rows || [];
    const incomeRows = breakdownRows
      .find(r => r.Title === 'Income')
      ?.Rows?.filter(r => r.RowType === 'Row') || [];
    const expenseRows = breakdownRows
      .find(r => r.Title?.includes('Expenses'))
      ?.Rows?.filter(r => r.RowType === 'Row') || [];

    // Chart totals
    const chartTotals = {
      income: chartData.reduce((s, m) => s + (m.income || 0), 0),
      expenses: chartData.reduce((s, m) => s + (m.expenses || 0), 0),
      profit: chartData.reduce((s, m) => s + (m.profit || 0), 0)
    };

    return Response.json({
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
    });

  } catch (error) {
    console.error('Xero data error:', error.message || error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}