# Xero OAuth + Supabase

Create the **`xero_tokens`** table manually in the Supabase SQL Editor (or via a migration).

## SQL — `xero_tokens`

Single-row table (id `1`) stores the org connection for this app instance.

```sql
create table if not exists public.xero_tokens (
  id bigint primary key default 1,
  tenant_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

-- Optional: keep one row only (enforce if you want strict single-tenant storage)
-- alter table public.xero_tokens add constraint xero_tokens_single_row check (id = 1);
```

### Row Level Security

API routes use the **service role** key and bypass RLS for server-side writes. If you enable RLS, add a policy that allows only the service role (or no policies for `anon` / `authenticated` so only the service role can access).

```sql
alter table public.xero_tokens enable row level security;
-- No policies needed if only SUPABASE_SERVICE_ROLE_KEY is used server-side.
```

## Xero Developer Portal — granular scopes

In **[developer.xero.com](https://developer.xero.com)** → your app → **Configuration** (or **OAuth 2.0 scopes**), enable the same scopes your code requests. For this project, enable:

| Scope | Purpose |
|-------|---------|
| `openid` | OpenID Connect |
| `profile` | User profile |
| `email` | User email |
| `offline_access` | Refresh tokens |
| `accounting.invoices.read` | Invoices (e.g. `/api/xero/invoices`) |
| `accounting.payments.read` | Payments |
| `accounting.contacts.read` | Contacts |
| `accounting.reports.profitandloss.read` | Profit & loss reports |
| `accounting.reports.executivesummary.read` | Executive summary reports |

If a scope is missing in the portal, consent may fail or API calls will return **403**. After changing scopes, users may need to **re-authorise** the app.

## Environment variables

Add to `.env.local` (and your host’s env in production):

| Variable | Description |
|----------|-------------|
| `XERO_CLIENT_ID` | Xero app Client id |
| `XERO_CLIENT_SECRET` | Xero app Client secret |
| `XERO_REDIRECT_URI` | OAuth callback URL (defaults to `http://localhost:3000/api/xero/callback` if unset). In production set to your public URL, e.g. `https://yourdomain.com/api/xero/callback`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only; never expose to the browser) |

## Flow

1. User visits **`GET /api/xero/auth`** → redirect to Xero consent.
2. Xero redirects to **`GET /api/xero/callback`** → tokens saved to `xero_tokens`, then redirect to `?xero=connected` or `?xero=error`.
3. **`GET /api/xero/invoices`** → reads tokens, refreshes if expired, returns invoices + summary JSON.
