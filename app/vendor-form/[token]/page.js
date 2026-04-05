"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const PRIMARY = "#245eb0";
const PRIMARY_LIGHT = "#e8f0fb";
const TEXT = "#1a2744";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const CARD_SHADOW = "0 4px 24px rgba(15, 23, 42, 0.08)";

const inputStyle = {
  width: "100%",
  minHeight: 48,
  padding: "12px 14px",
  fontSize: 16,
  border: `1.5px solid ${BORDER}`,
  borderRadius: 10,
  background: "#fff",
  color: TEXT,
  boxSizing: "border-box",
  WebkitAppearance: "none",
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: TEXT,
  marginBottom: 8,
};

function ToggleYesNo({ value, onChange, style }) {
  return (
    <div style={{ display: "flex", gap: 10, ...style }}>
      {[
        { v: true, label: "Yes" },
        { v: false, label: "No" },
      ].map(({ v, label }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          style={{
            flex: 1,
            minHeight: 52,
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 12,
            border: value === v ? `2px solid ${PRIMARY}` : `1.5px solid ${BORDER}`,
            background: value === v ? PRIMARY_LIGHT : "#fff",
            color: value === v ? PRIMARY : TEXT,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TitleHoldButtons({ value, onChange }) {
  const opts = [
    { id: "sole", label: "Sole Owner" },
    { id: "joint", label: "Joint Owners" },
    { id: "company", label: "Company" },
    { id: "trust", label: "Trust" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          style={{
            minHeight: 52,
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 12,
            border: value === o.id ? `2px solid ${PRIMARY}` : `1.5px solid ${BORDER}`,
            background: value === o.id ? PRIMARY_LIGHT : "#fff",
            color: value === o.id ? PRIMARY : TEXT,
            cursor: "pointer",
            padding: "12px 10px",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SaleMethodButtons({ value, onChange }) {
  const opts = [
    { id: "private_treaty", label: "Private Treaty" },
    { id: "auction", label: "Auction" },
  ];
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          style={{
            flex: 1,
            minHeight: 52,
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 12,
            border: value === o.id ? `2px solid ${PRIMARY}` : `1.5px solid ${BORDER}`,
            background: value === o.id ? PRIMARY_LIGHT : "#fff",
            color: value === o.id ? PRIMARY : TEXT,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PossessionButtons({ value, onChange }) {
  const opts = [
    { id: "vacant", label: "Vacant Possession" },
    { id: "tenanted", label: "Tenanted" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          style={{
            minHeight: 52,
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 12,
            border: value === o.id ? `2px solid ${PRIMARY}` : `1.5px solid ${BORDER}`,
            background: value === o.id ? PRIMARY_LIGHT : "#fff",
            color: value === o.id ? PRIMARY : TEXT,
            cursor: "pointer",
            textAlign: "left",
            padding: "14px 16px",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function emptyForm() {
  return {
    vendorFirstName: "",
    vendorLastName: "",
    vendorDob: "",
    vendorEmail: "",
    vendorPhone: "",
    vendorAddress: "",
    hasCoVendor: null,
    coVendorName: "",
    coVendorDob: "",
    propertyAddress: "",
    propertyAddressLocked: false,
    ownershipType: "",
    entityName: "",
    entityAbn: "",
    hasMortgage: null,
    lenderName: "",
    loanAccountNumber: "",
    estimatedPayout: "",
    possessionType: "",
    tenantName: "",
    tenantLeaseExpiry: "",
    weeklyRent: "",
    buildingWorks: null,
    buildingWorksDetails: "",
    ownerBuilder: null,
    poolOrSpa: null,
    smokeAlarms: true,
    inclusions: "",
    exclusions: "",
    agentFirstName: "",
    agentLastName: "",
    agencyName: "",
    agentPhone: "",
    agentEmail: "",
    saleMethod: "",
    expectedPrice: "",
    expectedListingDate: "",
    specialConditions: "",
    additionalNotes: "",
  };
}

function mergePrefill(form, row) {
  if (!row || typeof row !== "object") return form;
  const next = { ...form };
  const str = (formKey, ...rowKeys) => {
    let v;
    for (const k of rowKeys) {
      if (row[k] != null && row[k] !== "") {
        v = row[k];
        break;
      }
    }
    if (v != null && v !== "") next[formKey] = String(v);
  };
  str("vendorFirstName", "vendor_first_name", "first_name");
  str("vendorLastName", "vendor_last_name", "last_name");
  str("vendorDob", "vendor_dob", "date_of_birth");
  str("vendorEmail", "vendor_email", "email");
  str("vendorPhone", "vendor_phone", "vendor_mobile", "mobile");
  str("vendorAddress", "vendor_address", "current_address");
  str("coVendorName", "co_vendor_name", "co_vendor_full_name");
  str("coVendorDob", "co_vendor_dob", "co_vendor_date_of_birth");
  if (row.has_co_vendor === true || row.has_co_vendor === false) next.hasCoVendor = row.has_co_vendor;
  str("propertyAddress", "property_address", "address");
  if (row.property_address || row.address) {
    next.propertyAddressLocked = true;
  }
  str("ownershipType", "ownership_type", "title_hold_type");
  str("entityName", "entity_name");
  str("entityAbn", "entity_abn", "abn_acn");
  if (row.has_mortgage === true || row.has_mortgage === false) next.hasMortgage = row.has_mortgage;
  str("lenderName", "lender_name");
  str("loanAccountNumber", "loan_account_number");
  str("estimatedPayout", "estimated_payout", "estimated_payout_amount");
  str("possessionType", "possession_type");
  str("tenantName", "tenant_name");
  str("tenantLeaseExpiry", "tenant_lease_expiry", "lease_expiry_date");
  str("weeklyRent", "weekly_rent");
  if (row.building_works_last_7_years === true || row.building_works_last_7_years === false) {
    next.buildingWorks = row.building_works_last_7_years;
  }
  str("buildingWorksDetails", "building_works_details");
  if (row.owner_builder === true || row.owner_builder === false) {
    next.ownerBuilder = row.owner_builder;
  } else if (row.owner_builder_work === true || row.owner_builder_work === false) {
    next.ownerBuilder = row.owner_builder_work;
  }
  if (row.pool_or_spa === true || row.pool_or_spa === false) {
    next.poolOrSpa = row.pool_or_spa;
  } else if (row.has_pool_spa === true || row.has_pool_spa === false) {
    next.poolOrSpa = row.has_pool_spa;
  }
  if (row.smoke_alarms_compliant === true || row.smoke_alarms_compliant === false) {
    next.smokeAlarms = row.smoke_alarms_compliant;
  }
  str("inclusions", "inclusions");
  str("exclusions", "exclusions");
  str("agentFirstName", "agent_first_name");
  str("agentLastName", "agent_last_name");
  str("agencyName", "agency_name");
  str("agentPhone", "agent_phone");
  str("agentEmail", "agent_email");
  str("saleMethod", "sale_method");
  str("expectedPrice", "expected_price", "expected_sale_price");
  str("expectedListingDate", "expected_listing_date");
  str("specialConditions", "special_conditions");
  str("additionalNotes", "additional_notes");
  return next;
}

/** Payload keys must match vendor_instructions columns exactly — no extra keys. */
function buildVendorSubmitPayload(form) {
  return {
    vendor_first_name: form.vendorFirstName,
    vendor_last_name: form.vendorLastName,
    vendor_dob: form.vendorDob,
    vendor_email: form.vendorEmail,
    vendor_phone: form.vendorPhone,
    vendor_address: form.vendorAddress,
    co_vendor_name: form.coVendorName,
    co_vendor_dob: form.coVendorDob,
    property_address: form.propertyAddress,
    ownership_type: form.ownershipType,
    entity_name: form.entityName,
    entity_abn: form.entityAbn,
    has_mortgage: form.hasMortgage,
    lender_name: form.lenderName,
    loan_account_number: form.loanAccountNumber,
    estimated_payout: form.estimatedPayout,
    possession_type: form.possessionType,
    tenant_name: form.tenantName,
    tenant_lease_expiry: form.tenantLeaseExpiry,
    weekly_rent: form.weeklyRent,
    building_works_last_7_years: form.buildingWorks,
    building_works_details: form.buildingWorksDetails,
    owner_builder: form.ownerBuilder,
    pool_or_spa: form.poolOrSpa,
    smoke_alarms_compliant: form.smokeAlarms,
    inclusions: form.inclusions,
    exclusions: form.exclusions,
    agent_first_name: form.agentFirstName,
    agent_last_name: form.agentLastName,
    agency_name: form.agencyName,
    agent_phone: form.agentPhone,
    agent_email: form.agentEmail,
    sale_method: form.saleMethod,
    expected_price: form.expectedPrice,
    expected_listing_date: form.expectedListingDate,
    special_conditions: form.specialConditions,
    additional_notes: form.additionalNotes,
  };
}

const PARTIAL_STEP_DB_KEYS = [
  ["vendor_first_name", "vendor_last_name", "vendor_dob", "vendor_email", "vendor_phone", "vendor_address"],
  ["co_vendor_name", "co_vendor_dob"],
  ["property_address", "ownership_type", "entity_name", "entity_abn"],
  ["has_mortgage", "lender_name", "loan_account_number", "estimated_payout"],
  [
    "possession_type",
    "tenant_name",
    "tenant_lease_expiry",
    "weekly_rent",
    "building_works_last_7_years",
    "building_works_details",
    "owner_builder",
    "pool_or_spa",
    "smoke_alarms_compliant",
  ],
  ["inclusions", "exclusions"],
  [
    "agent_first_name",
    "agent_last_name",
    "agency_name",
    "agent_phone",
    "agent_email",
    "sale_method",
    "expected_price",
    "expected_listing_date",
  ],
  ["special_conditions", "additional_notes"],
];

function pickPartialPayload(stepIndex, form) {
  const full = buildVendorSubmitPayload(form);
  const keys = PARTIAL_STEP_DB_KEYS[stepIndex] || [];
  const o = {};
  keys.forEach((k) => {
    if (full[k] !== undefined) o[k] = full[k];
  });
  return o;
}

function isFormComplete(f) {
  if (!String(f.vendorFirstName || "").trim() || !String(f.vendorLastName || "").trim()) return false;
  if (!String(f.vendorEmail || "").trim() || !String(f.vendorPhone || "").trim()) return false;
  if (f.hasCoVendor === null) return false;
  if (f.hasCoVendor && !String(f.coVendorName || "").trim()) return false;
  if (!f.ownershipType) return false;
  if ((f.ownershipType === "company" || f.ownershipType === "trust") && !String(f.entityName || "").trim()) return false;
  if (f.hasMortgage === null) return false;
  if (f.hasMortgage && !String(f.lenderName || "").trim()) return false;
  if (!f.possessionType) return false;
  if (f.possessionType === "tenanted") {
    if (!String(f.tenantName || "").trim() || !String(f.tenantLeaseExpiry || "").trim() || !String(f.weeklyRent || "").trim()) return false;
  }
  if (f.buildingWorks === null || f.ownerBuilder === null || f.poolOrSpa === null) return false;
  if (f.buildingWorks && !String(f.buildingWorksDetails || "").trim()) return false;
  if (
    !String(f.agentFirstName || "").trim() ||
    !String(f.agentLastName || "").trim() ||
    !String(f.agentEmail || "").trim() ||
    !String(f.agentPhone || "").trim() ||
    !f.saleMethod ||
    !String(f.expectedPrice || "").trim()
  ) {
    return false;
  }
  return true;
}

const STEPS = [
  { title: "Your Details", subtitle: "Tell us who you are so we can complete your vendor documents." },
  { title: "Co-Vendor", subtitle: "Let us know if someone else owns this property with you." },
  { title: "Your Property", subtitle: "How you hold title and the property we’re selling." },
  { title: "Mortgage & Finance", subtitle: "Details about any loan secured on the property." },
  { title: "Property Details", subtitle: "Occupancy, works, and compliance information." },
  { title: "Inclusions & Exclusions", subtitle: "What stays and what goes with the sale." },
  { title: "Your Agent", subtitle: "Your selling agent and sale expectations." },
  { title: "Anything Else?", subtitle: "Special instructions or extra notes for your conveyancer." },
  { title: "Review", subtitle: "Check your answers before submitting." },
];

export default function VendorFormPage() {
  const params = useParams();
  const token = params?.token;

  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [rowStatus, setRowStatus] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [savingStep, setSavingStep] = useState(false);

  const update = useCallback((patch) => {
    setForm((f) => ({ ...f, ...patch }));
  }, []);

  useEffect(() => {
    if (!token) {
      setLoadState("error");
      setLoadError("Missing link.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/vendor-form/${encodeURIComponent(token)}`);
        if (res.status === 404) {
          if (!cancelled) {
            setLoadState("invalid");
          }
          return;
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          if (!cancelled) {
            setLoadState("error");
            setLoadError(j.error || "Could not load form.");
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "submitted") {
          setRowStatus("submitted");
          setLoadState("ready");
          return;
        }
        setRowStatus(data.status || null);
        setForm(() => mergePrefill(emptyForm(), data));
        setLoadState("ready");
      } catch {
        if (!cancelled) {
          setLoadState("error");
          setLoadError("Network error. Please try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const progressPct = useMemo(() => ((step + 1) / 9) * 100, [step]);

  const canGoNext = useMemo(() => {
    if (step === 0) {
      return (
        String(form.vendorFirstName || "").trim() &&
        String(form.vendorLastName || "").trim() &&
        String(form.vendorEmail || "").trim() &&
        String(form.vendorPhone || "").trim()
      );
    }
    if (step === 1) {
      if (form.hasCoVendor === null) return false;
      if (form.hasCoVendor) {
        return String(form.coVendorName || "").trim().length > 0;
      }
      return true;
    }
    if (step === 2) {
      if (!form.ownershipType) return false;
      if (form.ownershipType === "company" || form.ownershipType === "trust") {
        return String(form.entityName || "").trim().length > 0;
      }
      return true;
    }
    if (step === 3) {
      if (form.hasMortgage === null) return false;
      if (form.hasMortgage) {
        return String(form.lenderName || "").trim().length > 0;
      }
      return true;
    }
    if (step === 4) {
      if (!form.possessionType) return false;
      if (form.possessionType === "tenanted") {
        return (
          String(form.tenantName || "").trim() &&
          String(form.tenantLeaseExpiry || "").trim() &&
          String(form.weeklyRent || "").trim()
        );
      }
      if (form.buildingWorks === null || form.ownerBuilder === null || form.poolOrSpa === null) {
        return false;
      }
      if (form.buildingWorks && !String(form.buildingWorksDetails || "").trim()) {
        return false;
      }
      return true;
    }
    if (step === 5) return true;
    if (step === 6) {
      return (
        String(form.agentFirstName || "").trim() &&
        String(form.agentLastName || "").trim() &&
        String(form.agentEmail || "").trim() &&
        String(form.agentPhone || "").trim() &&
        form.saleMethod &&
        String(form.expectedPrice || "").trim()
      );
    }
    if (step === 7) return true;
    if (step === 8) return isFormComplete(form);
    return true;
  }, [step, form]);

  const handleSubmit = async () => {
    setSubmitError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendor-form/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          formData: buildVendorSubmitPayload(form),
          partial: false,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(j.error || "Submission failed.");
        setSubmitting(false);
        return;
      }
      setSubmitDone(true);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /** Partial save only runs from the Next button onClick — not from useEffect or render. */
  const handleGoNext = useCallback(async () => {
    if (!canGoNext || !token) return;
    const slice = pickPartialPayload(step, form);
    if (Object.keys(slice).length > 0) {
      setSavingStep(true);
      try {
        await fetch("/api/vendor-form/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, formData: slice, partial: true }),
        });
      } catch (_) {
        /* non-blocking */
      } finally {
        setSavingStep(false);
      }
    }
    setStep((s) => Math.min(8, s + 1));
  }, [canGoNext, token, step, form]);

  const shell = {
    minHeight: "100dvh",
    background: "#f1f5f9",
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: "max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))",
    maxWidth: 520,
    margin: "0 auto",
    boxSizing: "border-box",
  };

  if (loadState === "loading") {
    return (
      <div style={shell}>
        <div style={{ textAlign: "center", padding: "48px 0", color: MUTED, fontSize: 15 }}>Loading your form…</div>
      </div>
    );
  }

  if (loadState === "invalid") {
    return (
      <div style={shell}>
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 28,
            boxShadow: CARD_SHADOW,
            textAlign: "center",
            marginTop: 24,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 10 }}>Link unavailable</div>
          <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.6, margin: 0 }}>
            This link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div style={shell}>
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 28,
            boxShadow: CARD_SHADOW,
            textAlign: "center",
            marginTop: 24,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 10 }}>Something went wrong</div>
          <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.6, margin: 0 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (rowStatus === "submitted" || submitDone) {
    return (
      <div style={shell}>
        <header style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: PRIMARY, letterSpacing: "-0.02em" }}>Conveyancing Crew</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Vendor instructions</div>
        </header>
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 28,
            boxShadow: CARD_SHADOW,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 12px" }}>Thank you!</h1>
          <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.65, margin: 0 }}>
            Your details have been submitted to Conveyancing Crew. We will be in touch shortly.
          </p>
        </div>
      </div>
    );
  }

  const card = {
    background: "#fff",
    borderRadius: 16,
    padding: "22px 18px",
    boxShadow: CARD_SHADOW,
    marginBottom: 16,
  };

  const btnPrimary = {
    flex: 1,
    minHeight: 52,
    fontSize: 16,
    fontWeight: 700,
    border: "none",
    borderRadius: 12,
    background: PRIMARY,
    color: "#fff",
    cursor: "pointer",
  };

  const btnGhost = {
    flex: 1,
    minHeight: 52,
    fontSize: 16,
    fontWeight: 600,
    border: `1.5px solid ${BORDER}`,
    borderRadius: 12,
    background: "#fff",
    color: TEXT,
    cursor: "pointer",
  };

  return (
    <div style={shell}>
      <header style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: PRIMARY, letterSpacing: "-0.02em" }}>Conveyancing Crew</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Secure vendor instruction form</div>
      </header>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Step {step + 1} of 9</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: PRIMARY }}>{STEPS[step].title}</span>
        </div>
        <div style={{ height: 6, background: BORDER, borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progressPct}%`, background: PRIMARY, borderRadius: 99, transition: "width 0.25s ease" }} />
        </div>
      </div>

      {step < 8 && (
        <div style={card}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 6px" }}>{STEPS[step].title}</h2>
          <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.5, margin: "0 0 22px" }}>{STEPS[step].subtitle}</p>

          {step === 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>First name *</label>
                  <input style={inputStyle} value={form.vendorFirstName} onChange={(e) => update({ vendorFirstName: e.target.value })} autoComplete="given-name" />
                </div>
                <div>
                  <label style={labelStyle}>Last name *</label>
                  <input style={inputStyle} value={form.vendorLastName} onChange={(e) => update({ vendorLastName: e.target.value })} autoComplete="family-name" />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Date of birth (optional)</label>
                <input type="date" style={inputStyle} value={form.vendorDob} onChange={(e) => update({ vendorDob: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Email *</label>
                <input type="email" style={inputStyle} value={form.vendorEmail} onChange={(e) => update({ vendorEmail: e.target.value })} autoComplete="email" inputMode="email" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Mobile *</label>
                <input type="tel" style={inputStyle} value={form.vendorPhone} onChange={(e) => update({ vendorPhone: e.target.value })} autoComplete="tel" inputMode="tel" />
              </div>
              <div>
                <label style={labelStyle}>Current address</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 88, resize: "vertical", lineHeight: 1.45 }}
                  value={form.vendorAddress}
                  onChange={(e) => update({ vendorAddress: e.target.value })}
                  placeholder="Street, suburb, state, postcode"
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Is there a co-owner of this property?</label>
              <ToggleYesNo value={form.hasCoVendor} onChange={(v) => update({ hasCoVendor: v })} style={{ marginBottom: 18 }} />
              {form.hasCoVendor && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Co-vendor full name *</label>
                    <input style={inputStyle} value={form.coVendorName} onChange={(e) => update({ coVendorName: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Co-vendor date of birth</label>
                    <input type="date" style={inputStyle} value={form.coVendorDob} onChange={(e) => update({ coVendorDob: e.target.value })} />
                  </div>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Property address</label>
                <input
                  style={{
                    ...inputStyle,
                    background: form.propertyAddressLocked ? "#f8fafc" : "#fff",
                    color: form.propertyAddressLocked ? MUTED : TEXT,
                  }}
                  value={form.propertyAddress}
                  onChange={(e) => !form.propertyAddressLocked && update({ propertyAddress: e.target.value })}
                  readOnly={form.propertyAddressLocked}
                  placeholder="Property being sold"
                />
                {form.propertyAddressLocked && (
                  <p style={{ fontSize: 12, color: MUTED, margin: "8px 0 0" }}>Provided by your conveyancer — contact us if this needs changing.</p>
                )}
              </div>
              <label style={{ ...labelStyle, marginBottom: 10 }}>How do you hold title?</label>
              <TitleHoldButtons value={form.ownershipType} onChange={(v) => update({ ownershipType: v })} />
              {(form.ownershipType === "company" || form.ownershipType === "trust") && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Entity name *</label>
                    <input style={inputStyle} value={form.entityName} onChange={(e) => update({ entityName: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>ABN / ACN</label>
                    <input style={inputStyle} value={form.entityAbn} onChange={(e) => update({ entityAbn: e.target.value })} inputMode="numeric" />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Is there a mortgage on this property?</label>
              <ToggleYesNo value={form.hasMortgage} onChange={(v) => update({ hasMortgage: v })} style={{ marginBottom: 18 }} />
              {form.hasMortgage && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Lender name *</label>
                    <input style={inputStyle} value={form.lenderName} onChange={(e) => update({ lenderName: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Loan account number (optional)</label>
                    <input style={inputStyle} value={form.loanAccountNumber} onChange={(e) => update({ loanAccountNumber: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Estimated payout amount (optional)</label>
                    <input style={inputStyle} value={form.estimatedPayout} onChange={(e) => update({ estimatedPayout: e.target.value })} inputMode="decimal" placeholder="$" />
                  </div>
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Possession at settlement</label>
              <PossessionButtons value={form.possessionType} onChange={(v) => update({ possessionType: v })} />
              {form.possessionType === "tenanted" && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Tenant name *</label>
                    <input style={inputStyle} value={form.tenantName} onChange={(e) => update({ tenantName: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Lease expiry date *</label>
                    <input type="date" style={inputStyle} value={form.tenantLeaseExpiry} onChange={(e) => update({ tenantLeaseExpiry: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={labelStyle}>Weekly rent *</label>
                    <input style={inputStyle} value={form.weeklyRent} onChange={(e) => update({ weeklyRent: e.target.value })} inputMode="decimal" />
                  </div>
                </div>
              )}
              <label style={{ ...labelStyle, marginBottom: 10 }}>Any building works or permits in the last 7 years?</label>
              <ToggleYesNo value={form.buildingWorks} onChange={(v) => update({ buildingWorks: v })} style={{ marginBottom: 12 }} />
              {form.buildingWorks && (
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Please describe *</label>
                  <textarea style={{ ...inputStyle, minHeight: 88 }} value={form.buildingWorksDetails} onChange={(e) => update({ buildingWorksDetails: e.target.value })} />
                </div>
              )}
              <label style={{ ...labelStyle, marginBottom: 10 }}>Was any work done by an owner builder?</label>
              <ToggleYesNo value={form.ownerBuilder} onChange={(v) => update({ ownerBuilder: v })} style={{ marginBottom: 18 }} />
              <label style={{ ...labelStyle, marginBottom: 10 }}>Is there a pool or spa?</label>
              <ToggleYesNo value={form.poolOrSpa} onChange={(v) => update({ poolOrSpa: v })} style={{ marginBottom: 18 }} />
              <label style={{ ...labelStyle, marginBottom: 10 }}>Are smoke alarms compliant?</label>
              <ToggleYesNo value={form.smokeAlarms} onChange={(v) => update({ smokeAlarms: v })} />
            </>
          )}

          {step === 5 && (
            <>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>What is INCLUDED in the sale?</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 100, lineHeight: 1.45 }}
                  value={form.inclusions}
                  onChange={(e) => update({ inclusions: e.target.value })}
                  placeholder="e.g. dishwasher, blinds, light fittings, garden shed"
                />
              </div>
              <div>
                <label style={labelStyle}>What is EXCLUDED from the sale?</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 100, lineHeight: 1.45 }}
                  value={form.exclusions}
                  onChange={(e) => update({ exclusions: e.target.value })}
                  placeholder="e.g. dining room chandelier, outdoor furniture"
                />
              </div>
            </>
          )}

          {step === 6 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Agent first name *</label>
                  <input style={inputStyle} value={form.agentFirstName} onChange={(e) => update({ agentFirstName: e.target.value })} autoComplete="off" />
                </div>
                <div>
                  <label style={labelStyle}>Agent last name *</label>
                  <input style={inputStyle} value={form.agentLastName} onChange={(e) => update({ agentLastName: e.target.value })} autoComplete="off" />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Agency name</label>
                <input style={inputStyle} value={form.agencyName} onChange={(e) => update({ agencyName: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Agent phone *</label>
                <input type="tel" style={inputStyle} value={form.agentPhone} onChange={(e) => update({ agentPhone: e.target.value })} inputMode="tel" />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Agent email *</label>
                <input type="email" style={inputStyle} value={form.agentEmail} onChange={(e) => update({ agentEmail: e.target.value })} inputMode="email" />
              </div>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Sale method *</label>
              <SaleMethodButtons value={form.saleMethod} onChange={(v) => update({ saleMethod: v })} />
              <div style={{ marginTop: 18 }}>
                <label style={labelStyle}>Expected sale price *</label>
                <input style={inputStyle} value={form.expectedPrice} onChange={(e) => update({ expectedPrice: e.target.value })} inputMode="decimal" placeholder="e.g. 850000" />
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Expected listing date (optional)</label>
                <input type="date" style={inputStyle} value={form.expectedListingDate} onChange={(e) => update({ expectedListingDate: e.target.value })} />
              </div>
            </>
          )}

          {step === 7 && (
            <>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Any special conditions or instructions for your conveyancer?</label>
                <textarea style={{ ...inputStyle, minHeight: 110, lineHeight: 1.45 }} value={form.specialConditions} onChange={(e) => update({ specialConditions: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Additional notes (optional)</label>
                <textarea style={{ ...inputStyle, minHeight: 88, lineHeight: 1.45 }} value={form.additionalNotes} onChange={(e) => update({ additionalNotes: e.target.value })} />
              </div>
            </>
          )}
        </div>
      )}

      {step === 8 && (
        <div style={card}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 6px" }}>Review your answers</h2>
          <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.5, margin: "0 0 18px" }}>Please check everything before you submit.</p>
          <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.65 }}>
            {[
              ["Name", `${form.vendorFirstName} ${form.vendorLastName}`.trim()],
              ["Date of birth", form.vendorDob || "—"],
              ["Email", form.vendorEmail || "—"],
              ["Mobile", form.vendorPhone || "—"],
              ["Current address", form.vendorAddress || "—"],
              [
                "Co-owner",
                form.hasCoVendor == null
                  ? "—"
                  : form.hasCoVendor
                    ? `Yes — ${form.coVendorName}${form.coVendorDob ? ` (DOB ${form.coVendorDob})` : ""}`
                    : "No",
              ],
              ["Property", form.propertyAddress || "—"],
              ["Title held as", form.ownershipType || "—"],
              [
                "Entity / ABN",
                (() => {
                  if (!form.entityName && !form.entityAbn) return "—";
                  const parts = [form.entityName, form.entityAbn].filter(Boolean);
                  return parts.join(" · ") || "—";
                })(),
              ],
              ["Mortgage", form.hasMortgage == null ? "—" : form.hasMortgage ? `Yes — ${form.lenderName}` : "No"],
              ["Possession", form.possessionType || "—"],
              ["Tenancy details", form.possessionType === "tenanted" ? `${form.tenantName}, expires ${form.tenantLeaseExpiry}, ${form.weeklyRent}/wk` : "—"],
              ["Building works (7 yrs)", form.buildingWorks == null ? "—" : form.buildingWorks ? form.buildingWorksDetails : "No"],
              ["Owner builder work", form.ownerBuilder == null ? "—" : form.ownerBuilder ? "Yes" : "No"],
              ["Pool / spa", form.poolOrSpa == null ? "—" : form.poolOrSpa ? "Yes" : "No"],
              ["Smoke alarms compliant", form.smokeAlarms ? "Yes" : "No"],
              ["Inclusions", form.inclusions || "—"],
              ["Exclusions", form.exclusions || "—"],
              ["Agent", `${form.agentFirstName} ${form.agentLastName}`.trim()],
              ["Agency", form.agencyName || "—"],
              ["Agent contact", `${form.agentPhone} · ${form.agentEmail}`],
              ["Sale method", form.saleMethod === "auction" ? "Auction" : form.saleMethod === "private_treaty" ? "Private Treaty" : "—"],
              ["Expected price", form.expectedPrice || "—"],
              ["Listing date", form.expectedListingDate || "—"],
              ["Special conditions", form.specialConditions || "—"],
              ["Notes", form.additionalNotes || "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{k}</div>
                <div style={{ color: TEXT }}>{v}</div>
              </div>
            ))}
          </div>
          {submitError ? (
            <p style={{ color: "#b91c1c", fontSize: 14, marginTop: 14, marginBottom: 0 }}>{submitError}</p>
          ) : null}
          <button type="button" style={{ ...btnPrimary, width: "100%", marginTop: 22, flex: "none" }} disabled={submitting || !canGoNext} onClick={handleSubmit}>
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      )}

      {step < 8 && (
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          {step > 0 ? (
            <button type="button" style={btnGhost} onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          ) : (
            <div style={{ flex: 1 }} />
          )}
          <button type="button" style={btnPrimary} disabled={!canGoNext || savingStep} onClick={handleGoNext}>
            {savingStep ? "Saving…" : "Next →"}
          </button>
        </div>
      )}

      {step === 8 && (
        <div style={{ marginTop: 12 }}>
          <button type="button" style={{ ...btnGhost, width: "100%" }} onClick={() => setStep(7)}>
            ← Back to edit
          </button>
        </div>
      )}

      <p style={{ textAlign: "center", fontSize: 11, color: MUTED, marginTop: 28, lineHeight: 1.5 }}>
        Your information is sent securely to Conveyancing Crew only.
      </p>
    </div>
  );
}
