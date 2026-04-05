import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const maxDuration = 30

export async function POST(request) {
  try {
    const body = await request.json()
    const { token, formData, partial } = body

    console.log("[submit] token:", token, "partial:", partial, "formData keys:", formData ? Object.keys(formData).join(",") : "none")

    if (!token) return NextResponse.json({ error: "No token" }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // 1. Look up the vendor_instructions row by token
    const { data: row, error: lookupError } = await supabase
      .from("vendor_instructions")
      .select("*")
      .eq("token", token)
      .single()

    if (lookupError || !row) {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 })
    }

    const matterRef = row.matter_ref

    // 2. Build clean update payload - strip token and matter_ref
    const payload = {}
    if (formData && typeof formData === "object") {
      for (const [key, val] of Object.entries(formData)) {
        if (key !== "token" && key !== "matter_ref") {
          payload[key] = val
        }
      }
    }

    // 3. If partial save - just update fields and return
    if (partial) {
      await supabase
        .from("vendor_instructions")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("token", token)
      return NextResponse.json({ success: true })
    }

    // 4. Full submit - update vendor_instructions with submitted status
    await supabase
      .from("vendor_instructions")
      .update({
        ...payload,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("token", token)

    console.log("[submit] vendor_instructions updated successfully")

    // 5. Insert task - do this synchronously before response
    const today = new Date().toISOString().split("T")[0]
    const vendorName = [payload.vendor_first_name || row.vendor_first_name, payload.vendor_last_name || row.vendor_last_name].filter(Boolean).join(" ") || "Vendor"
    const propertyAddress = payload.property_address || row.property_address || ""
    const vendorEmail = payload.vendor_email || row.vendor_email || ""

    try {
      await supabase.from("tasks").insert({
        matter_ref: matterRef,
        task: "Vendor form submitted — review and update matter details",
        urgency: "high",
        done: false,
        due_date: today
      })
    } catch (taskErr) {
      console.error("[vendor-form/submit] task insert error:", taskErr.message)
    }
    console.log("[submit] task insert attempted")

    // 6. Build email body for Gitu
    const staffBody = `A vendor instruction form has been submitted for matter ${matterRef}.

VENDOR DETAILS
Name: ${vendorName}
Email: ${vendorEmail}
Phone: ${payload.vendor_phone || row.vendor_phone || "—"}
Address: ${payload.vendor_address || row.vendor_address || "—"}
Date of Birth: ${payload.vendor_dob || row.vendor_dob || "—"}

CO-VENDOR
${(payload.co_vendor_name || row.co_vendor_name) ? `Name: ${payload.co_vendor_name || row.co_vendor_name}\nDOB: ${payload.co_vendor_dob || row.co_vendor_dob || "—"}` : "None"}

PROPERTY
Address: ${propertyAddress}
Ownership Type: ${payload.ownership_type || row.ownership_type || "—"}
Entity Name: ${payload.entity_name || row.entity_name || "—"}

MORTGAGE
Has Mortgage: ${payload.has_mortgage || row.has_mortgage ? "Yes" : "No"}
Lender: ${payload.lender_name || row.lender_name || "—"}
Estimated Payout: ${payload.estimated_payout || row.estimated_payout || "—"}

PROPERTY DETAILS
Possession: ${payload.possession_type || row.possession_type || "—"}
Tenant Name: ${payload.tenant_name || row.tenant_name || "—"}
Weekly Rent: ${payload.weekly_rent || row.weekly_rent || "—"}
Building Works: ${payload.building_works_last_7_years || row.building_works_last_7_years ? "Yes - " + (payload.building_works_details || row.building_works_details || "") : "No"}
Owner Builder: ${payload.owner_builder || row.owner_builder ? "Yes" : "No"}
Pool/Spa: ${payload.pool_or_spa || row.pool_or_spa ? "Yes" : "No"}
Smoke Alarms Compliant: ${(payload.smoke_alarms_compliant ?? row.smoke_alarms_compliant) === false ? "No" : "Yes"}

INCLUSIONS & EXCLUSIONS
Inclusions: ${payload.inclusions || row.inclusions || "—"}
Exclusions: ${payload.exclusions || row.exclusions || "—"}

AGENT DETAILS
Agent: ${[payload.agent_first_name || row.agent_first_name, payload.agent_last_name || row.agent_last_name].filter(Boolean).join(" ") || "—"}
Agency: ${payload.agency_name || row.agency_name || "—"}
Agent Phone: ${payload.agent_phone || row.agent_phone || "—"}
Agent Email: ${payload.agent_email || row.agent_email || "—"}
Sale Method: ${payload.sale_method || row.sale_method || "—"}
Expected Price: ${payload.expected_price || row.expected_price || "—"}
Listing Date: ${payload.expected_listing_date || row.expected_listing_date || "—"}

SPECIAL CONDITIONS
${payload.special_conditions || row.special_conditions || "None"}

NOTES
${payload.additional_notes || row.additional_notes || "None"}`

    // 7. Send email to Gitu - synchronously before response
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://conveyancing-crew.vercel.app"
    try {
      console.log("[submit] sending staff email to gitu")
      const staffEmailRes = await fetch(`${appUrl}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "gitu@conveyancingcrew.com.au",
          subject: `Vendor Form Submitted — ${vendorName} | ${propertyAddress}`,
          body: staffBody,
          matterId: matterRef
        })
      })
      console.log("[submit] staff email status:", staffEmailRes.status)
      if (!staffEmailRes.ok) {
        const errText = await staffEmailRes.text()
        console.error("[vendor-form/submit] staff email failed:", errText)
      }
    } catch (emailErr) {
      console.error("[vendor-form/submit] staff email error:", emailErr.message)
    }

    // 8. Send confirmation email to vendor - synchronously before response
    if (vendorEmail) {
      const clientBody = `Hi ${payload.vendor_first_name || row.vendor_first_name || "there"},

Thank you for completing your vendor instruction form. We have received your details and will begin preparing your sale contract shortly.

Here is a record of the information you provided:

Property: ${propertyAddress}
Sale Method: ${payload.sale_method || row.sale_method || "—"}
Expected Price: ${payload.expected_price || row.expected_price || "—"}
Agent: ${[payload.agent_first_name || row.agent_first_name, payload.agent_last_name || row.agent_last_name].filter(Boolean).join(" ") || "—"}
Agency: ${payload.agency_name || row.agency_name || "—"}
Possession at Settlement: ${payload.possession_type || row.possession_type || "—"}
Has Mortgage: ${payload.has_mortgage || row.has_mortgage ? "Yes" : "No"}
${(payload.has_mortgage || row.has_mortgage) ? `Lender: ${payload.lender_name || row.lender_name || "—"}` : ""}
Inclusions: ${payload.inclusions || row.inclusions || "—"}
Exclusions: ${payload.exclusions || row.exclusions || "—"}

If any of the above information is incorrect or you need to make changes, please contact us at gitu@conveyancingcrew.com.au

Kind regards,
Gitu Kaur
Conveyancing Crew
gitu@conveyancingcrew.com.au
02 XXXX XXXX`

      try {
        console.log("[submit] sending client email to:", vendorEmail)
        const clientEmailRes = await fetch(`${appUrl}/api/email/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: vendorEmail,
            subject: "Your property sale details received — Conveyancing Crew",
            body: clientBody,
            matterId: matterRef
          })
        })
        console.log("[submit] client email status:", clientEmailRes.status)
        if (!clientEmailRes.ok) {
          const errText = await clientEmailRes.text()
          console.error("[vendor-form/submit] client email failed:", errText)
        }
      } catch (emailErr) {
        console.error("[vendor-form/submit] client email error:", emailErr.message)
      }
    }

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error("[vendor-form/submit] unhandled error:", err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
