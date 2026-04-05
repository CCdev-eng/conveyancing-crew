import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/vendor-form/[token]
 * Public — no auth. Returns the vendor_instructions row for prepopulating the client form.
 */
export async function GET(_request, context) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json(
      { error: "Supabase URL or service role key not configured" },
      { status: 500 }
    );
  }

  const params = await context.params;
  const token = params?.token;
  if (!token || typeof token !== "string") {
    return Response.json({ error: "token is required" }, { status: 400 });
  }

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("vendor_instructions")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(data);
}
