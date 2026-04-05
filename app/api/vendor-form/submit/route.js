import { createClient } from "@supabase/supabase-js";

function parseMatterNotesObject(notesStr) {
  if (!notesStr || typeof notesStr !== "string" || !notesStr.trim().startsWith("{")) return {};
  try {
    const p = JSON.parse(notesStr);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

function yn(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "—";
}

function s(v) {
  if (v == null || v === "") return "—";
  return String(v).trim() || "—";
}

/** Staff / Gitu — structured sections */
function buildSubmittedSummaryStaff(d, matterRef) {
  const agentName = [d.agent_first_name, d.agent_last_name].filter(Boolean).join(" ").trim();
  const lines = [
    `A vendor instruction form has been submitted for matter ${matterRef}.`,
    "",
    `Open the app at https://conveyancing-crew.vercel.app, locate this matter, and check the Workflow tab for next steps.`,
    "",
    "──────── VENDOR DETAILS ────────",
    `Name: ${s(d.vendor_first_name)} ${s(d.vendor_last_name)}`.trim(),
    `DOB: ${s(d.vendor_dob)}`,
    `Email: ${s(d.vendor_email)}`,
    `Phone: ${s(d.vendor_phone)}`,
    `Address: ${s(d.vendor_address)}`,
    "",
    "──────── CO-VENDOR ────────",
    `Name: ${s(d.co_vendor_name)}`,
    `DOB: ${s(d.co_vendor_dob)}`,
    "",
    "──────── PROPERTY ────────",
    `Address: ${s(d.property_address)}`,
    `Ownership type: ${s(d.ownership_type)}`,
    `Entity name: ${s(d.entity_name)}`,
    `ABN / ACN: ${s(d.entity_abn)}`,
    "",
    "──────── MORTGAGE ────────",
    `Has mortgage: ${yn(d.has_mortgage)}`,
    `Lender: ${s(d.lender_name)}`,
    `Account number: ${s(d.loan_account_number)}`,
    `Estimated payout: ${s(d.estimated_payout)}`,
    "",
    "──────── PROPERTY DETAILS ────────",
    `Possession: ${s(d.possession_type)}`,
    `Tenant name: ${s(d.tenant_name)}`,
    `Lease expiry: ${s(d.tenant_lease_expiry)}`,
    `Weekly rent: ${s(d.weekly_rent)}`,
    `Building works (7 yrs): ${yn(d.building_works_last_7_years)}`,
    `Building works details: ${s(d.building_works_details)}`,
    `Owner builder: ${yn(d.owner_builder)}`,
    `Pool / spa: ${yn(d.pool_or_spa)}`,
    `Smoke alarms compliant: ${yn(d.smoke_alarms_compliant)}`,
    "",
    "──────── INCLUSIONS & EXCLUSIONS ────────",
    `Inclusions: ${s(d.inclusions)}`,
    `Exclusions: ${s(d.exclusions)}`,
    "",
    "──────── AGENT DETAILS ────────",
    `Agent: ${agentName || "—"}`,
    `Agency: ${s(d.agency_name)}`,
    `Phone: ${s(d.agent_phone)}`,
    `Email: ${s(d.agent_email)}`,
    `Sale method: ${s(d.sale_method)}`,
    `Expected price: ${s(d.expected_price)}`,
    `Listing date: ${s(d.expected_listing_date)}`,
    "",
    "──────── SPECIAL CONDITIONS & NOTES ────────",
    `Special conditions: ${s(d.special_conditions)}`,
    `Additional notes: ${s(d.additional_notes)}`,
  ];
  return lines.join("\n");
}

/** Client — friendlier wording */
function buildSubmittedSummaryClient(d, matterRef, firstName) {
  const agentName = [d.agent_first_name, d.agent_last_name].filter(Boolean).join(" ").trim();
  const hi = firstName && String(firstName).trim() ? String(firstName).trim() : "there";
  const lines = [
    `Hi ${hi},`,
    "",
    "Thank you for completing your vendor instruction form. We have received your details and will begin preparing your sale contract shortly.",
    "",
    "Here is a record of the information you provided:",
    "",
    "Your details",
    `— Name: ${s(d.vendor_first_name)} ${s(d.vendor_last_name)}`,
    `— Date of birth: ${s(d.vendor_dob)}`,
    `— Email: ${s(d.vendor_email)}`,
    `— Phone: ${s(d.vendor_phone)}`,
    `— Current address: ${s(d.vendor_address)}`,
    "",
    "Co-vendor (if any)",
    `— ${s(d.co_vendor_name)}${d.co_vendor_dob ? `, DOB ${d.co_vendor_dob}` : ""}`,
    "",
    "Property",
    `— Address being sold: ${s(d.property_address)}`,
    `— How you hold title: ${s(d.ownership_type)}`,
    `— Entity / ABN: ${s(d.entity_name)}${d.entity_abn ? ` / ${d.entity_abn}` : ""}`,
    "",
    "Mortgage",
    `— Mortgage on the property: ${yn(d.has_mortgage)}`,
    `— Lender: ${s(d.lender_name)}`,
    `— Loan account: ${s(d.loan_account_number)}`,
    `— Estimated payout: ${s(d.estimated_payout)}`,
    "",
    "Occupancy & property condition",
    `— Possession at settlement: ${s(d.possession_type)}`,
    d.possession_type === "tenanted"
      ? `— Tenant: ${s(d.tenant_name)}, lease to ${s(d.tenant_lease_expiry)}, rent ${s(d.weekly_rent)}/week`
      : "— (Not tenanted)",
    `— Building works in last 7 years: ${yn(d.building_works_last_7_years)}${d.building_works_details ? ` — ${d.building_works_details}` : ""}`,
    `— Owner-builder work: ${yn(d.owner_builder)}`,
    `— Pool or spa: ${yn(d.pool_or_spa)}`,
    `— Smoke alarms compliant: ${yn(d.smoke_alarms_compliant)}`,
    "",
    "Inclusions & exclusions",
    `— Included: ${s(d.inclusions)}`,
    `— Excluded: ${s(d.exclusions)}`,
    "",
    "Selling agent",
    `— ${agentName || "—"} at ${s(d.agency_name)}`,
    `— Contact: ${s(d.agent_phone)} / ${s(d.agent_email)}`,
    `— Sale method: ${s(d.sale_method)}`,
    `— Expected price: ${s(d.expected_price)}`,
    `— Expected listing date: ${s(d.expected_listing_date)}`,
    "",
    "Other",
    `— Special conditions or instructions: ${s(d.special_conditions)}`,
    `— Additional notes: ${s(d.additional_notes)}`,
    "",
    "Matter reference (for your records): " + matterRef,
    "",
    "If any of the above information is incorrect or you need to make changes, please contact us at gitu@conveyancingcrew.com.au or call us directly.",
    "",
    "Kind regards,",
    "Gitu Kaur",
    "Conveyancing Crew",
    "gitu@conveyancingcrew.com.au",
  ];
  return lines.join("\n");
}

function internalAppOrigin() {
  const u = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return u.replace(/\/$/, "") || "http://localhost:3000";
}

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

  const matter_ref = row.matter_ref;
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

  if (!isPartial) {
    const d = formData;
    const base = internalAppOrigin();
    const fn = s(d.vendor_first_name);
    const ln = s(d.vendor_last_name);
    const prop = s(d.property_address);
    const subjectGitu = `✅ Vendor Form Submitted — ${fn} ${ln} | ${prop}`.replace(/\s+\|\s+—$/, "").trim();
    const summaryStaff = buildSubmittedSummaryStaff(d, matter_ref);
    const summaryClient = buildSubmittedSummaryClient(d, matter_ref, d.vendor_first_name);
    const vendorTo = String(d.vendor_email || "").trim();

    void (async () => {
      try {
        const { data: matterRow, error: mErr } = await supabase
          .from("matters")
          .select("notes, client_name")
          .eq("matter_ref", matter_ref)
          .maybeSingle();
        if (mErr) {
          console.error("[vendor-form/submit] matters select", mErr);
        } else {
          const notesObj = parseMatterNotesObject(
            typeof matterRow?.notes === "string" ? matterRow.notes : ""
          );
          notesObj._vendorFormStatus = "submitted";
          notesObj._vendorFormSubmitted = true;
          notesObj._vendorFormSubmittedAt = submittedAt;

          const matterPatch = { notes: JSON.stringify(notesObj) };
          const agentCombined = [d.agent_first_name, d.agent_last_name]
            .map((x) => (x != null ? String(x).trim() : ""))
            .filter(Boolean)
            .join(" ")
            .trim();
          if (agentCombined) matterPatch.agent = agentCombined;
          const ap = String(d.agent_phone ?? "").trim();
          if (ap) matterPatch.agent_phone = ap;
          const ae = String(d.agent_email ?? "").trim();
          if (ae) matterPatch.agent_email = ae;
          const epRaw = d.expected_price;
          if (epRaw != null && String(epRaw).trim() !== "") {
            const digits = String(epRaw).replace(/[^0-9]/g, "");
            if (digits) matterPatch.price = parseInt(digits, 10);
          }

          const { error: upMatters } = await supabase.from("matters").update(matterPatch).eq("matter_ref", matter_ref);
          if (upMatters) console.error("[vendor-form/submit] matters update", upMatters);
        }
      } catch (e) {
        console.error("[vendor-form/submit] matter side effects", e);
      }

      try {
        const clientNameForTask =
          [d.vendor_first_name, d.vendor_last_name].filter(Boolean).join(" ").trim() || "Vendor";
        const { error: taskErr } = await supabase.from("tasks").insert({
          matter_ref,
          client_name: clientNameForTask,
          task: "Vendor form submitted — review and update matter details",
          urgency: "high",
          done: false,
          due_date: submittedAt.slice(0, 10),
          notes: `Auto-created: vendor ${clientNameForTask} submitted their instruction form`,
        });
        if (taskErr) console.error("[vendor-form/submit] tasks insert", taskErr);
      } catch (e) {
        console.error("[vendor-form/submit] task", e);
      }

      await Promise.allSettled([
        fetch(`${base}/api/email/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: "gitu@conveyancingcrew.com.au",
            subject: subjectGitu,
            body: summaryStaff,
            matterId: matter_ref,
          }),
        }),
        vendorTo
          ? fetch(`${base}/api/email/send`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: vendorTo,
                subject: "Your property sale details received — Conveyancing Crew",
                body: summaryClient,
                matterId: matter_ref,
              }),
            })
          : Promise.resolve(),
      ]);
    })();
  }

  return Response.json({ success: true });
}
