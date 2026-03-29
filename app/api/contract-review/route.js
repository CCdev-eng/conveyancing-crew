import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  runContractReviewEngine,
  runDocxContractReview,
} from "@/app/lib/contractReviewEngine";

export const maxDuration = 300;

export async function POST(request) {
  try {
    const { storagePath, matterContext, bucketName } = await request.json();
    const bucket = bucketName || "matter-documents";

    if (!storagePath) {
      return NextResponse.json({ error: "No storage path provided" }, { status: 400 });
    }

    console.log("[ContractReview API] Bucket:", bucket, "| path:", storagePath);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error("[ContractReview API] Missing Supabase URL or key");
      return NextResponse.json(
        { error: "Server is not configured for storage" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60);

    if (signedError || !signedData?.signedUrl) {
      console.error("[ContractReview API] Signed URL error:", signedError);
      return NextResponse.json(
        { error: "Could not access document in storage" },
        { status: 500 }
      );
    }

    console.log("[ContractReview API] Fetching document from storage...");

    const pdfRes = await fetch(signedData.signedUrl);
    if (!pdfRes.ok) {
      return NextResponse.json(
        { error: "Could not download document from storage" },
        { status: 500 }
      );
    }

    const arrayBuf = await pdfRes.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuf);

    const lowerPath = (storagePath || "").toLowerCase();
    const isDocx = lowerPath.endsWith(".docx");

    console.log(
      "[ContractReview API] Document size:",
      Math.round(pdfBuffer.length / 1024),
      "KB",
      "| type:",
      isDocx ? "docx" : "pdf"
    );

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("[ContractReview API] ANTHROPIC_API_KEY is not set");
      return NextResponse.json(
        { error: "Server is not configured for contract review" },
        { status: 500 }
      );
    }

    if (isDocx) {
      let parsed;
      try {
        parsed = await runDocxContractReview(pdfBuffer, matterContext);
      } catch (e) {
        console.error("[ContractReview API] Parse or review error:", e.message);
        return NextResponse.json(
          { error: "Failed to parse AI response: " + e.message },
          { status: 500 }
        );
      }
      return NextResponse.json(parsed);
    }

    const parsed = await runContractReviewEngine(pdfBuffer, matterContext);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[ContractReview API] Unhandled error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Contract review failed" },
      { status: 500 }
    );
  }
}
