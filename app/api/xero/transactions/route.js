import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const parseXeroDate = (xeroDate) => {
  if (!xeroDate) return "";
  // Handle /Date(timestamp)/ format
  if (typeof xeroDate === "string" && xeroDate.includes("/Date(")) {
    const timestamp = parseInt(
      xeroDate.replace(/\/Date\((\d+)[^)]*\)\//, "$1"),
      10
    );
    if (!isNaN(timestamp)) {
      return new Date(timestamp).toISOString().split("T")[0];
    }
  }
  // Handle regular ISO date
  if (typeof xeroDate === "string") {
    return xeroDate.split("T")[0];
  }
  return "";
};

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

const EXCLUDED_PL_LABELS = new Set([
  "Gross Profit",
  "Net Profit",
  "Net Loss",
  "Total Income",
  "Total Operating Expenses",
]);

function parsePlAmount(v) {
  return parseFloat(String(v ?? "0").replace(/[^0-9.-]/g, "")) || 0;
}

async function fetchPL(headers, fromDate, toDate) {
  try {
    const res = await fetch(
      "https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss" +
      "?fromDate=" + fromDate + "&toDate=" + toDate,
      { headers }
    );
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text)?.Reports?.[0] || null;
  } catch(e) { return null; }
}

export async function GET(request) {
  try {
    const tokenData = await getValidToken();
    if (!tokenData || !tokenData.access_token) {
      return Response.json({ error: "Not connected to Xero" }, { status: 401 });
    }

    const tenantId = tokenData.tenant_id;
    const headers = {
      "Authorization": "Bearer " + tokenData.access_token,
      "Xero-tenant-id": tenantId,
      "Accept": "application/json"
    };

    const { searchParams } = new URL(request.url);
    const accountName = searchParams.get("accountName") || "";
    const fromDate = searchParams.get("fromDate") || "2025-07-01";
    const toDate = searchParams.get("toDate") ||
      new Date().toISOString().split("T")[0];

    console.log("Fetching transactions for:", accountName, fromDate, toDate);

    const isIncomeSearch = ["income", "sales", "revenue"].includes(
      accountName.toLowerCase()
    );

    const isExpenseSearch = [
      "operating expenses",
      "expenses",
      "less operating expenses",
      "less expenses",
    ].includes(accountName.toLowerCase());

    const isBroadSearch = !accountName;

    // Specific account name: use P&L (bank LineItems are often empty)
    if (!isBroadSearch && !isIncomeSearch && !isExpenseSearch) {
      const report = await fetchPL(headers, fromDate, toDate);
      if (!report) {
        return Response.json({
          transactions: [],
          accountName,
          fromDate,
          toDate,
          total: 0,
          note: "No P&L data found for this period",
        });
      }

      const rows = report.Rows || [];
      const lineItems = [];

      rows.forEach((section) => {
        if (section.RowType !== "Section") return;
        section.Rows?.forEach((row) => {
          if (row.RowType !== "Row") return;
          const name = row.Cells?.[0]?.Value || "";
          const amount = parsePlAmount(row.Cells?.[1]?.Value);
          if (
            amount !== 0 &&
            name.toLowerCase().includes(accountName.toLowerCase()) &&
            name !== "Gross Profit" &&
            name !== "Net Profit" &&
            name !== "Net Loss" &&
            !EXCLUDED_PL_LABELS.has(name)
          ) {
            lineItems.push({
              date: fromDate + " to " + toDate,
              description: name,
              reference: section.Title || "",
              accountName: name,
              netAmount: amount,
              sourceType: section.Title || "P&L",
            });
          }
        });
      });

      const total = lineItems.reduce((s, t) => s + t.netAmount, 0);
      return Response.json({
        transactions: lineItems,
        accountName,
        fromDate,
        toDate,
        total,
        note: "Showing P&L summary. Bank feed integration shows individual transactions.",
      });
    }

    // Broad income/expense / no account: bank transactions
    const bankRes = await fetch(
      `https://api.xero.com/api.xro/2.0/BankTransactions?pageSize=100&fromDate=${fromDate}&toDate=${toDate}`,
      { headers }
    );

    console.log("BankTransactions status:", bankRes.status);

    if (bankRes.ok) {
      const bankData = await bankRes.json();
      const bankTx = bankData?.BankTransactions || [];

      console.log("First bank tx sample:", JSON.stringify(bankTx[0], null, 2));
      console.log("Bank transactions found:", bankTx.length);

      console.log(
        "Searching for:",
        accountName,
        "Type filter:",
        isIncomeSearch ? "RECEIVE" : isExpenseSearch ? "SPEND" : "ALL",
        "Transactions after date filter:",
        bankTx.filter((tx) => {
          const txDate = parseXeroDate(tx.Date);
          if (fromDate && txDate < fromDate) return false;
          if (toDate && txDate > toDate) return false;
          return true;
        }).length
      );

      const filtered = bankTx.filter((tx) => {
        const txDate = parseXeroDate(tx.Date);
        if (!txDate) return true;
        if (fromDate && txDate < fromDate) return false;
        if (toDate && txDate > toDate) return false;

        if (isIncomeSearch) return tx.Type === "RECEIVE";
        if (isExpenseSearch) return tx.Type === "SPEND";
        if (isBroadSearch) return true;

        return false;
      });

      const transactions = filtered.map((tx) => ({
        date: parseXeroDate(tx.Date),
        description:
          tx.Contact?.Name ||
          tx.LineItems?.[0]?.Description ||
          tx.Reference ||
          "Bank Transaction",
        reference: tx.Reference || "",
        accountName:
          tx.LineItems?.[0]?.AccountName || tx.BankAccount?.Name || "",
        netAmount:
          tx.Type === "SPEND" ? -(tx.Total || 0) : tx.Total || 0,
        sourceType: tx.Type || "BANK",
        bankAccount: tx.BankAccount?.Name || "",
      }));

      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      const total = transactions.reduce((sum, t) => sum + t.netAmount, 0);

      return Response.json({ transactions, accountName, fromDate, toDate, total });
    }

    // Fall back to P&L breakdown if bank transactions not available
    const report = await fetchPL(headers, fromDate, toDate);
    if (!report) {
      return Response.json({ error: "Could not fetch data" }, { status: 500 });
    }

    const rows = report.Rows || [];
    console.log(
      "P&L sections:",
      rows.filter((r) => r.RowType === "Section").map((r) => r.Title)
    );
    const lineItems = [];
    const search = accountName.toLowerCase();

    rows.forEach((section) => {
      if (section.RowType !== "Section") return;

      const sectionTitle = section.Title?.toLowerCase() || "";

      const isIncomeSearch =
        search === "income" || search === "sales" || search === "revenue";
      const isExpenseSearch =
        search.includes("expense") ||
        search.includes("operating") ||
        search === "expenses" ||
        search === "less operating expenses" ||
        search === "operating expenses";

      const isSectionMatch =
        sectionTitle.includes(search) ||
        search.includes(sectionTitle) ||
        (isIncomeSearch && sectionTitle === "income") ||
        (isExpenseSearch &&
          (sectionTitle.includes("expense") ||
            sectionTitle.includes("operating"))) ||
        !accountName;

      if (!isSectionMatch) {
        section.Rows?.forEach((row) => {
          if (row.RowType !== "Row") return;
          const name = row.Cells?.[0]?.Value || "";
          const amount = parsePlAmount(row.Cells?.[1]?.Value);
          if (
            name.toLowerCase() === search &&
            amount !== 0 &&
            !EXCLUDED_PL_LABELS.has(name)
          ) {
            lineItems.push({
              date: fromDate + " to " + toDate,
              description: name,
              reference: section.Title || "",
              accountName: name,
              netAmount: amount,
              sourceType: section.Title || "P&L",
            });
          }
        });
        return;
      }

      section.Rows?.forEach((row) => {
        if (row.RowType !== "Row") return;
        const name = row.Cells?.[0]?.Value || "";
        const amount = parsePlAmount(row.Cells?.[1]?.Value);
        if (
          amount !== 0 &&
          name &&
          !EXCLUDED_PL_LABELS.has(name)
        ) {
          lineItems.push({
            date: fromDate + " to " + toDate,
            description: name,
            reference: section.Title || "",
            accountName: name,
            netAmount: amount,
            sourceType: section.Title || "P&L",
          });
        }
      });
    });

    const total = lineItems.reduce((sum, t) => sum + t.netAmount, 0);

    return Response.json({
      transactions: lineItems,
      accountName,
      fromDate,
      toDate,
      total,
      note: "Showing P&L summary. Connect bank feeds in Xero for individual transactions."
    });

  } catch (error) {
    console.error("Transactions error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}