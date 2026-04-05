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

    // Re-fetch row to get all saved data including current submission
    const { data: freshRow } = await supabase
      .from("vendor_instructions")
      .select("*")
      .eq("token", token)
      .single()
    const fullRow = freshRow || row

    // 5. Insert task - do this synchronously before response
    const today = new Date().toISOString().split("T")[0]
    const vendorName = [fullRow.vendor_first_name, fullRow.vendor_last_name].filter(Boolean).join(" ") || "Vendor"
    const propertyAddress = fullRow.property_address || ""
    const vendorEmail = fullRow.vendor_email || ""

    try {
      await supabase.from("tasks").insert({
        matter_ref: matterRef,
        client_name: vendorName,
        task: "Vendor form submitted — review and update matter details",
        urgency: "high",
        done: false,
        due_date: today
      })
    } catch (taskErr) {
      console.error("[vendor-form/submit] task insert error:", taskErr.message)
    }
    console.log("[submit] task insert attempted")

    // Update matters table - use row data which has ALL fields from partial saves
    try {
      const matterPatch = {}
      const agentFirst = fullRow.agent_first_name || ""
      const agentLast = fullRow.agent_last_name || ""
      const agentFullName = [agentFirst, agentLast].filter(Boolean).join(" ").trim()
      if (agentFullName) matterPatch.agent_name = agentFullName
      if (fullRow.agent_phone) matterPatch.agent_phone = fullRow.agent_phone
      if (fullRow.agent_email) matterPatch.agent_email = fullRow.agent_email
      if (fullRow.expected_price) matterPatch.price = String(fullRow.expected_price)
      if (fullRow.possession_type) matterPatch.is_tenanted = fullRow.possession_type === "tenanted"
      if (fullRow.special_conditions) matterPatch.special_conditions = fullRow.special_conditions

      console.log("[submit] matterPatch:", JSON.stringify(matterPatch))

      if (Object.keys(matterPatch).length > 0) {
        matterPatch.updated_at = new Date().toISOString()
        const { error: matterErr } = await supabase
          .from("matters")
          .update(matterPatch)
          .eq("matter_ref", matterRef)
        if (matterErr) {
          console.error("[submit] matter update error:", matterErr.message)
        } else {
          console.log("[submit] matter updated successfully:", Object.keys(matterPatch).join(","))
        }
      } else {
        console.log("[submit] matterPatch empty - no matter update needed")
      }
    } catch (matterUpdateErr) {
      console.error("[submit] matter update exception:", matterUpdateErr.message)
    }

    // 6. Build email body for Gitu
    const staffBody = `A vendor instruction form has been submitted for matter ${matterRef}.

VENDOR DETAILS
Name: ${vendorName}
Email: ${vendorEmail}
Phone: ${fullRow.vendor_phone || "—"}
Address: ${fullRow.vendor_address || "—"}
Date of Birth: ${fullRow.vendor_dob || "—"}

CO-VENDOR
${fullRow.co_vendor_name ? `Name: ${fullRow.co_vendor_name}\nDOB: ${fullRow.co_vendor_dob || "—"}` : "None"}

PROPERTY
Address: ${propertyAddress}
Ownership Type: ${fullRow.ownership_type || "—"}
Entity Name: ${fullRow.entity_name || "—"}

MORTGAGE
Has Mortgage: ${fullRow.has_mortgage ? "Yes" : "No"}
Lender: ${fullRow.lender_name || "—"}
Estimated Payout: ${fullRow.estimated_payout || "—"}

PROPERTY DETAILS
Possession: ${fullRow.possession_type || "—"}
Tenant Name: ${fullRow.tenant_name || "—"}
Weekly Rent: ${fullRow.weekly_rent || "—"}
Building Works: ${fullRow.building_works_last_7_years ? "Yes - " + (fullRow.building_works_details || "") : "No"}
Owner Builder: ${fullRow.owner_builder ? "Yes" : "No"}
Pool/Spa: ${fullRow.pool_or_spa ? "Yes" : "No"}
Smoke Alarms Compliant: ${fullRow.smoke_alarms_compliant === false ? "No" : "Yes"}

INCLUSIONS & EXCLUSIONS
Inclusions: ${fullRow.inclusions || "—"}
Exclusions: ${fullRow.exclusions || "—"}

AGENT DETAILS
Agent: ${[fullRow.agent_first_name, fullRow.agent_last_name].filter(Boolean).join(" ") || "—"}
Agency: ${fullRow.agency_name || "—"}
Agent Phone: ${fullRow.agent_phone || "—"}
Agent Email: ${fullRow.agent_email || "—"}
Sale Method: ${fullRow.sale_method || "—"}
Expected Price: ${fullRow.expected_price || "—"}
Listing Date: ${fullRow.expected_listing_date || "—"}

SPECIAL CONDITIONS
${fullRow.special_conditions || "None"}

NOTES
${fullRow.additional_notes || "None"}`

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
      const clientBody = `Hi ${fullRow.vendor_first_name || "there"},

Thank you for completing your vendor instruction form. We have received your details and will begin preparing your sale contract shortly.

Here is a record of the information you provided:

Property: ${propertyAddress}
Sale Method: ${fullRow.sale_method || "—"}
Expected Price: ${fullRow.expected_price || "—"}
Agent: ${[fullRow.agent_first_name, fullRow.agent_last_name].filter(Boolean).join(" ") || "—"}
Agency: ${fullRow.agency_name || "—"}
Possession at Settlement: ${fullRow.possession_type || "—"}
Has Mortgage: ${fullRow.has_mortgage ? "Yes" : "No"}
${fullRow.has_mortgage ? `Lender: ${fullRow.lender_name || "—"}` : ""}
Inclusions: ${fullRow.inclusions || "—"}
Exclusions: ${fullRow.exclusions || "—"}

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
