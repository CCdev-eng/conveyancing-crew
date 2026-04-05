import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/vendor-form/submit
 * Public — no auth. Body: { token, formData, partial? }
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

  const { token, formData, partial } = body || {};
  if (!token || typeof token !== "string") {
    return Response.json({ error: "token is required" }, { status: 400 });
  }
  if (!formData || typeof formData !== "object" || Array.isArray(formData)) {
    return Response.json({ error: "formData must be an object" }, { status: 400 });
  }

  const supabase = createClient(url, key);

  const { data: row, error: lookupError } = await supabase
    .from("vendor_instructions")
    .select("matter_ref")
    .eq("token", token)
    .maybeSingle();

  if (lookupError) {
    return Response.json({ error: lookupError.message }, { status: 500 });
  }
  if (!row?.matter_ref) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { token: _t, matter_ref: _m, ...restForm } = formData;
  const isPartial = partial === true;
  const submittedAt = new Date().toISOString();

  const updatePayload = { ...restForm };
  if (!isPartial) {
    updatePayload.status = "submitted";
    updatePayload.submitted_at = submittedAt;
  }

  const { error: updateError } = await supabase
    .from("vendor_instructions")
    .update(updatePayload)
    .eq("token", token);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
