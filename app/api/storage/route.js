import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request) {
  try {
    const { bucket, path } = await request.json();

    if (!bucket || !path) {
      return NextResponse.json(
        { error: "Missing bucket or path" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server credentials are not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);

    if (error) {
      console.error("Error creating signed URL on server:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create signed URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({ signedUrl: data?.signedUrl ?? null });
  } catch (err) {
    console.error("Storage route error:", err);
    return NextResponse.json(
      { error: "Unexpected error creating signed URL" },
      { status: 500 }
    );
  }
}

