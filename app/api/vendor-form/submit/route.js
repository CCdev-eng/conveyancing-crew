import { createClient } from "@supabase/supabase-js";

function buildAgentName(formData) {
  if (!formData || typeof formData !== "object") return null;
  if (formData.agent_name != null && String(formData.agent_name).trim()) {
    return String(formData.agent_name).trim();
  }
  if (formData.agent != null && String(formData.agent).trim()) {
    return String(formData.agent).trim();
  }
  const first = formData.agent_first_name != null ? String(formData.agent_first_name).trim() : "";
  const last = formData.agent_last_name != null ? String(formData.agent_last_name).trim() : "";
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

/**
 * POST /api/vendor-form/submit
 * Public — no auth. Body: { token, formData }
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

  const { token, formData } = body || {};
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
  const submittedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("vendor_instructions")
    .update({
      ...restForm,
      status: "submitted",
      submitted_at: submittedAt,
    })
    .eq("token", token);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  const matterPatch = {};
  const agentName = buildAgentName(formData);
  if (agentName) matterPatch.agent = agentName;
  if (formData.agent_phone != null && String(formData.agent_phone).trim() !== "") {
    matterPatch.agent_phone = String(formData.agent_phone).trim();
  }
  if (formData.agent_email != null && String(formData.agent_email).trim() !== "") {
    matterPatch.agent_email = String(formData.agent_email).trim();
  }

  if (Object.keys(matterPatch).length > 0) {
    const { error: matterError } = await supabase
      .from("matters")
      .update(matterPatch)
      .eq("matter_ref", row.matter_ref);
    if (matterError) {
      return Response.json({ error: matterError.message }, { status: 500 });
    }
  }

  return Response.json({ success: true });
}
