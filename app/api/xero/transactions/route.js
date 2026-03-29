import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { createXeroSupabaseClient } from "@/lib/xero-supabase-admin";

async function getValidToken() {
  // Try file first (local dev)
  try {
    const tokenPath = join(process.cwd(), 'xero-tokens.json');
    if (existsSync(tokenPath)) {
      const tokenData = JSON.parse(readFileSync(tokenPath, 'utf8'));
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();
      if (expiresAt - now > 5 * 60 * 1000) return tokenData;
      const refreshed = await refreshToken(tokenData);
      if (refreshed) {
        try { writeFileSync(tokenPath, JSON.stringify(refreshed, null, 2)); } catch(e) {}
        return refreshed;
      }
    }
  } catch(e) {}

  // Try Supabase (production)
  try {
    const supabase = createXeroSupabaseClient();
    if (!supabase) {
      console.warn("[Xero] Missing Supabase config for xero_tokens");
    } else {
    const { data, error: readErr } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('id', 1)
      .single();
    if (readErr) console.error("[Xero] xero_tokens read:", readErr.message);

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
    }
  } catch(e) {
    console.error('Supabase token fetch error:', e.message);
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
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[Xero] refresh failed:", res.status, t.slice(0, 300));
      return null;
    }
    const newTokenSet = await res.json();
    return {
      tenant_id: tokenData.tenant_id,
      access_token: newTokenSet.access_token,
      refresh_token: newTokenSet.refresh_token || tokenData.refresh_token,
      expires_at: new Date(Date.now() + (newTokenSet.expires_in * 1000)).toISOString()
    };
  } catch(e) { return null; }
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

const parseXeroDate = (xeroDate) => {
  if (!xeroDate) return '';
  if (typeof xeroDate === 'string' && xeroDate.includes('/Date(')) {
    const timestamp = parseInt(xeroDate.replace(/\/Date\((\d+)[^)]*\)\//, '$1'));
    if (!isNaN(timestamp)) return new Date(timestamp).toISOString().split('T')[0];
  }
  if (typeof xeroDate === 'string') return xeroDate.split('T')[0];
  return '';
};

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
    const accountName = searchParams.get('accountName') || '';
    const fromDate = searchParams.get('fromDate') || '2025-07-01';
    const toDate = searchParams.get('toDate') || new Date().toISOString().split('T')[0];

    console.log('Fetching transactions for:', accountName, fromDate, toDate);

    const isIncomeSearch = ['income', 'sales', 'revenue']
      .includes(accountName.toLowerCase());
    const isExpenseSearch = ['operating expenses', 'expenses',
      'less operating expenses', 'less expenses']
      .includes(accountName.toLowerCase());
    const isBroadSearch = !accountName;

    // For broad income/expense searches use bank transactions
    if (isIncomeSearch || isExpenseSearch || isBroadSearch) {
      const bankRes = await fetch(
        `https://api.xero.com/api.xro/2.0/BankTransactions?pageSize=100`,
        { headers }
      );

      console.log('BankTransactions status:', bankRes.status);

      if (bankRes.ok) {
        const bankData = await bankRes.json();
        const bankTx = bankData?.BankTransactions || [];

        const filtered = bankTx.filter(tx => {
          const txDate = parseXeroDate(tx.Date);
          if (!txDate) return true;
          if (fromDate && txDate < fromDate) return false;
          if (toDate && txDate > toDate) return false;
          if (isIncomeSearch) return tx.Type === 'RECEIVE';
          if (isExpenseSearch) return tx.Type === 'SPEND';
          return true;
        });

        const transactions = filtered.map(tx => ({
          date: parseXeroDate(tx.Date),
          description: tx.Contact?.Name ||
            tx.Reference || 'Bank Transaction',
          reference: tx.Reference || '',
          accountName: tx.BankAccount?.Name || '',
          netAmount: tx.Type === 'SPEND' ?
            -(tx.Total || 0) : (tx.Total || 0),
          sourceType: tx.Type || 'BANK',
          bankAccount: tx.BankAccount?.Name || ''
        }));

        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        const total = transactions.reduce((sum, t) => sum + t.netAmount, 0);

        return Response.json({ transactions, accountName, fromDate, toDate, total });
      }
    }

    // For specific account name searches use P&L report
    const report = await fetchPL(headers, fromDate, toDate);
    if (!report) {
      return Response.json({
        transactions: [], accountName, fromDate, toDate, total: 0,
        note: 'No P&L data found for this period'
      });
    }

    const rows = report.Rows || [];
    const lineItems = [];

    rows.forEach(section => {
      if (section.RowType !== 'Section') return;
      const sectionTitle = section.Title?.toLowerCase() || '';
      const search = accountName.toLowerCase();
      const isIncomeSection = sectionTitle === 'income';
      const isExpenseSection = sectionTitle.includes('expense');
      const sectionMatchesBroad = 
        (isIncomeSearch && isIncomeSection) ||
        (isExpenseSearch && isExpenseSection);

      section.Rows?.forEach(row => {
        if (row.RowType !== 'Row') return;
        const name = row.Cells?.[0]?.Value || '';
        const amount = parseFloat(row.Cells?.[1]?.Value || 0);
        if (amount === 0) return;
        if (['Gross Profit', 'Net Profit', 'Net Loss',
          'Total Income', 'Total Operating Expenses'].includes(name)) return;

        const nameMatch = name.toLowerCase().includes(search) ||
          search.includes(name.toLowerCase());
        if (nameMatch || sectionMatchesBroad) {
          lineItems.push({
            date: fromDate + ' to ' + toDate,
            description: name,
            reference: section.Title || '',
            accountName: name,
            netAmount: amount,
            sourceType: section.Title || 'P&L'
          });
        }
      });
    });

    const total = lineItems.reduce((s, t) => s + t.netAmount, 0);

    return Response.json({
      transactions: lineItems,
      accountName, fromDate, toDate, total,
      note: 'Showing P&L summary breakdown.'
    });

  } catch (error) {
    console.error('Transactions error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}