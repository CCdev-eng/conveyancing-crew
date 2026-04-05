import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/vendor-form/generate
 * Body: { matterRef, prefillData? }
 * Creates or reuses a vendor_instructions row and returns a shareable form URL.
 */
export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json(
      { error: "Supabase URL or service role key not configured" },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { matterRef, prefillData } = body || {};
  if (!matterRef || typeof matterRef !== "string") {
    return Response.json({ error: "matterRef is required" }, { status: 400 });
  }

  const supabase = createClient(url, key);

  const { data: existing, error: selectError } = await supabase
    .from("vendor_instructions")
    .select("token")
    .eq("matter_ref", matterRef)
    .maybeSingle();

  if (selectError) {
    return Response.json({ error: selectError.message }, { status: 500 });
  }

  const appBase = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  if (existing?.token) {
    return Response.json({
      token: existing.token,
      formUrl: `${appBase}/vendor-form/${existing.token}`,
    });
  }

  const safePrefill =
    prefillData && typeof prefillData === "object" && !Array.isArray(prefillData)
      ? { ...prefillData }
      : {};

  delete safePrefill.token;
  delete safePrefill.matter_ref;

  if (Object.prototype.hasOwnProperty.call(safePrefill, "expected_price")) {
    const ep = safePrefill.expected_price;
    delete safePrefill.expected_price;
    if (
      (safePrefill.expected_sale_price == null || String(safePrefill.expected_sale_price).trim() === "") &&
      ep != null &&
      String(ep).trim() !== ""
    ) {
      safePrefill.expected_sale_price = ep;
    }
  }

  const insertPayload = {
    matter_ref: matterRef,
    ...safePrefill,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("vendor_instructions")
    .insert(insertPayload)
    .select("token")
    .single();

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  const token = inserted?.token;
  if (!token) {
    return Response.json(
      { error: "Insert succeeded but no token returned" },
      { status: 500 }
    );
  }

  return Response.json({
    token,
    formUrl: `${appBase}/vendor-form/${token}`,
  });
}
