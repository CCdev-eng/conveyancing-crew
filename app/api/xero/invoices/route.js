import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

async function getValidToken() {
  const tokenPath = join(process.cwd(), "xero-tokens.json");
  if (!existsSync(tokenPath)) return null;

  const tokenData = JSON.parse(readFileSync(tokenPath, "utf8"));

  const expiresAt = new Date(tokenData.expires_at);
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt - now > fiveMinutes) {
    return tokenData;
  }

  console.log("Xero token expired, refreshing...");

  if (!tokenData.refresh_token) {
    console.log("No refresh token available");
    return null;
  }

  try {
    const credentials = Buffer.from(
      process.env.XERO_CLIENT_ID + ":" + process.env.XERO_CLIENT_SECRET
    ).toString("base64");

    const refreshRes = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + credentials,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenData.refresh_token,
      }),
    });

    if (!refreshRes.ok) {
      const err = await refreshRes.text();
      console.log("Token refresh failed:", err);
      return null;
    }

    const newTokenSet = await refreshRes.json();

    const newTokenData = {
      tenant_id: tokenData.tenant_id,
      access_token: newTokenSet.access_token,
      refresh_token: newTokenSet.refresh_token || tokenData.refresh_token,
      expires_at: new Date(Date.now() + newTokenSet.expires_in * 1000).toISOString(),
      scopes: newTokenSet.scope || tokenData.scopes,
    };

    writeFileSync(tokenPath, JSON.stringify(newTokenData, null, 2));
    console.log("Xero token refreshed successfully");

    return newTokenData;
  } catch (e) {
    console.log("Token refresh error:", e.message);
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
    if (!text || text.trim() === '') return null;
    const data = JSON.parse(text);
    return data?.Reports?.[0] || null;
  } catch(e) {
    console.log('P&L fetch error for', fromDate, '-', toDate, ':', e.message);
    return null;
  }
}

function parseCellNum(v) {
  return parseFloat(String(v ?? "0").replace(/[^0-9.-]/g, "")) || 0;
}

/** Match Xero P&L layout (Section rows + SummaryRow totals). */
function parsePL(report) {
  if (!report) return { income: 0, expenses: 0, profit: 0 };
  const rows = report.Rows || [];
  const incomeSection = rows.find((r) => r.RowType === "Section" && r.Title === "Income");
  const expSection = rows.find(
    (r) => r.RowType === "Section" && (r.Title || "").includes("Operating Expenses")
  );
  const income = parseCellNum(
    incomeSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value
  );
  const expenses = Math.abs(
    parseCellNum(expSection?.Rows?.find((r) => r.RowType === "SummaryRow")?.Cells?.[1]?.Value)
  );
  const netProfitRow = rows
    .flatMap((r) => r.Rows || [])
    .find((r) => r.RowType === "Row" && r.Cells?.[0]?.Value === "Net Profit");
  const netProfit = parseCellNum(netProfitRow?.Cells?.[1]?.Value);
  const profit = netProfitRow ? netProfit : income - expenses;
  return { income, expenses, profit };
}

function toLocalYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'monthly';

    const tokenData = await getValidToken();
    if (!tokenData || !tokenData.access_token) {
      return Response.json({ error: "Not connected to Xero" }, { status: 401 });
    }

    const tenantId = tokenData.tenant_id;
    const headers = {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Xero-tenant-id': tenantId,
      'Accept': 'application/json'
    };

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const currentQuarterMonth = Math.floor(today.getMonth() / 3) * 3;
    const currentQuarterFrom = toLocalYMD(
      new Date(today.getFullYear(), currentQuarterMonth, 1)
    );

    const currentMonthFrom = toLocalYMD(
      new Date(today.getFullYear(), today.getMonth(), 1)
    );

    const fyYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    const fyFrom = `${fyYear}-07-01`;

    const [currentMonthReport, currentQuarterReport, fyReport] = await Promise.all([
      fetchPL(headers, currentMonthFrom, todayStr),
      fetchPL(headers, currentQuarterFrom, todayStr),
      fetchPL(headers, fyFrom, todayStr),
    ]);

    const currentMonth = {
      ...parsePL(currentMonthReport),
      from: currentMonthFrom,
      to: todayStr,
      report: currentMonthReport,
    };
    const currentQuarter = {
      ...parsePL(currentQuarterReport),
      from: currentQuarterFrom,
      to: todayStr,
      report: currentQuarterReport,
    };
    const financialYear = {
      ...parsePL(fyReport),
      from: fyFrom,
      to: todayStr,
      report: fyReport,
    };

    const monthlyData = [];
    const quarterlyData = [];
    const yearlyData = [];

    if (period === 'quarterly') {
      for (let i = 3; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - (i * 3), 1);
        const quarterStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
        const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
        const from = toLocalYMD(quarterStart);
        const to = quarterEnd > today ? todayStr : toLocalYMD(quarterEnd);
        const label = `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()}`;
        const report = await fetchPL(headers, from, to);
        const parsed = parsePL(report);
        quarterlyData.push({ month: label, from, to, ...parsed, report });
        await new Promise((r) => setTimeout(r, 100));
      }
    } else if (period === 'yearly') {
      for (let i = 2; i >= 0; i--) {
        const fyYear =
          today.getMonth() >= 6 ? today.getFullYear() - i : today.getFullYear() - i - 1;
        const from = `${fyYear}-07-01`;
        const to = i === 0 ? todayStr : `${fyYear + 1}-06-30`;
        const label = `FY${String(fyYear + 1).slice(2)}`;
        const report = await fetchPL(headers, from, to);
        const parsed = parsePL(report);
        yearlyData.push({ month: label, from, to, ...parsed, report });
        await new Promise((r) => setTimeout(r, 100));
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
        const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0);
        const to = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
        const label = d.toLocaleDateString('en-AU', {month:'short', year:'2-digit'});
        
        const report = await fetchPL(headers, from, to);
        const parsed = parsePL(report);
        monthlyData.push({
          month: label,
          from,
          to,
          income: parsed.income,
          expenses: parsed.expenses,
          profit: parsed.profit,
          report
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    /** Previous calendar month (for % vs last month) when chart period is not monthly */
    let previousMonth = null;
    if (period !== 'monthly') {
      const pmStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const pmFrom = `${pmStart.getFullYear()}-${String(pmStart.getMonth() + 1).padStart(2, '0')}-01`;
      const pmLast = new Date(pmStart.getFullYear(), pmStart.getMonth() + 1, 0);
      const pmTo = `${pmLast.getFullYear()}-${String(pmLast.getMonth() + 1).padStart(2, '0')}-${String(pmLast.getDate()).padStart(2, '0')}`;
      const pmReport = await fetchPL(headers, pmFrom, pmTo);
      const pmParsed = parsePL(pmReport);
      previousMonth = {
        ...pmParsed,
        from: pmFrom,
        to: pmTo,
        report: pmReport,
      };
    }

    const chartData =
      period === "quarterly" ? quarterlyData : period === "yearly" ? yearlyData : monthlyData;

    const breakdownReport =
      period === "monthly"
        ? currentMonthReport
        : period === "quarterly"
          ? currentQuarterReport
          : fyReport;

    const breakdownRows = breakdownReport?.Rows || [];
    const incomeSection =
      breakdownRows.find((r) => r.RowType === "Section" && r.Title === "Income") ||
      breakdownRows.find((r) => r.Title === "Income");
    const expenseSection =
      breakdownRows.find(
        (r) => r.RowType === "Section" && (r.Title || "").includes("Expenses")
      ) || breakdownRows.find((r) => (r.Title || "").includes("Expenses"));
    const incomeRows =
      incomeSection?.Rows?.filter((r) => r.RowType === "Row" && r.Cells?.length >= 2) || [];
    const expenseRows =
      expenseSection?.Rows?.filter((r) => r.RowType === "Row" && r.Cells?.length >= 2) || [];

    const breakdownPeriod =
      period === "monthly"
        ? { fromDate: currentMonthFrom, toDate: todayStr }
        : period === "quarterly"
          ? { fromDate: currentQuarterFrom, toDate: todayStr }
          : { fromDate: fyFrom, toDate: todayStr };

    return Response.json({
      period,
      monthlyData,
      quarterlyData,
      yearlyData,
      chartData,
      previousMonth,
      currentMonth,
      currentQuarter,
      financialYear,
      incomeRows,
      expenseRows,
      breakdownPeriod,
      summary: {
        fromDate: fyFrom,
        toDate: todayStr,
        tenantName: "Conveyancing Crew",
      },
    });

  } catch (error) {
    console.error('Xero data error:', error.message || error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}