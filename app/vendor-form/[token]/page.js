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
    first_name: "",
    last_name: "",
    date_of_birth: "",
    email: "",
    mobile: "",
    current_address: "",
    has_co_vendor: null,
    co_vendor_full_name: "",
    co_vendor_date_of_birth: "",
    property_address: "",
    property_address_locked: false,
    title_hold_type: "",
    entity_name: "",
    abn_acn: "",
    has_mortgage: null,
    lender_name: "",
    loan_account_number: "",
    estimated_payout_amount: "",
    possession_type: "",
    tenant_name: "",
    lease_expiry_date: "",
    weekly_rent: "",
    building_works_last_7_years: null,
    building_works_details: "",
    owner_builder_work: null,
    has_pool_spa: null,
    smoke_alarms_compliant: true,
    inclusions: "",
    exclusions: "",
    agent_first_name: "",
    agent_last_name: "",
    agency_name: "",
    agent_phone: "",
    agent_email: "",
    sale_method: "",
    expected_sale_price: "",
    expected_listing_date: "",
    special_conditions: "",
    additional_notes: "",
  };
}

function mergePrefill(form, row) {
  if (!row || typeof row !== "object") return form;
  const next = { ...form };
  const str = (k, alt) => {
    const v = row[k] ?? row[alt];
    if (v != null && v !== "") next[k] = String(v);
  };
  str("first_name", "vendor_first_name");
  str("last_name", "vendor_last_name");
  str("date_of_birth");
  str("email", "vendor_email");
  str("mobile", "vendor_mobile");
  str("current_address");
  str("property_address", "address");
  if (row.property_address || row.address) {
    next.property_address_locked = true;
  }
  str("co_vendor_full_name");
  str("co_vendor_date_of_birth");
  if (row.has_co_vendor === true || row.has_co_vendor === false) next.has_co_vendor = row.has_co_vendor;
  str("title_hold_type");
  str("entity_name");
  str("abn_acn");
  if (row.has_mortgage === true || row.has_mortgage === false) next.has_mortgage = row.has_mortgage;
  str("lender_name");
  str("loan_account_number");
  str("estimated_payout_amount");
  str("possession_type");
  str("tenant_name");
  str("lease_expiry_date");
  str("weekly_rent");
  if (row.building_works_last_7_years === true || row.building_works_last_7_years === false) {
    next.building_works_last_7_years = row.building_works_last_7_years;
  }
  str("building_works_details");
  if (row.owner_builder_work === true || row.owner_builder_work === false) next.owner_builder_work = row.owner_builder_work;
  if (row.has_pool_spa === true || row.has_pool_spa === false) next.has_pool_spa = row.has_pool_spa;
  if (row.smoke_alarms_compliant === true || row.smoke_alarms_compliant === false) {
    next.smoke_alarms_compliant = row.smoke_alarms_compliant;
  }
  str("inclusions");
  str("exclusions");
  str("agent_first_name");
  str("agent_last_name");
  str("agency_name");
  str("agent_phone");
  str("agent_email");
  str("sale_method");
  str("expected_sale_price");
  str("expected_listing_date");
  str("special_conditions");
  str("additional_notes");
  return next;
}

function buildPayload(form) {
  const { property_address_locked, ...rest } = form;
  return rest;
}

function pickStepFormData(stepIndex, form) {
  const pick = (keys) => {
    const o = {};
    keys.forEach((k) => {
      if (form[k] !== undefined) o[k] = form[k];
    });
    return o;
  };
  switch (stepIndex) {
    case 0:
      return pick([
        "first_name",
        "last_name",
        "date_of_birth",
        "email",
        "mobile",
        "current_address",
      ]);
    case 1:
      return pick(["has_co_vendor", "co_vendor_full_name", "co_vendor_date_of_birth"]);
    case 2:
      return pick(["property_address", "property_address_locked", "title_hold_type", "entity_name", "abn_acn"]);
    case 3:
      return pick(["has_mortgage", "lender_name", "loan_account_number", "estimated_payout_amount"]);
    case 4:
      return pick([
        "possession_type",
        "tenant_name",
        "lease_expiry_date",
        "weekly_rent",
        "building_works_last_7_years",
        "building_works_details",
        "owner_builder_work",
        "has_pool_spa",
        "smoke_alarms_compliant",
      ]);
    case 5:
      return pick(["inclusions", "exclusions"]);
    case 6:
      return pick([
        "agent_first_name",
        "agent_last_name",
        "agency_name",
        "agent_phone",
        "agent_email",
        "sale_method",
        "expected_sale_price",
        "expected_listing_date",
      ]);
    case 7:
      return pick(["special_conditions", "additional_notes"]);
    default:
      return {};
  }
}

function stripLockedForApi(obj) {
  const { property_address_locked, token: _t, matter_ref: _m, ...rest } = obj;
  return rest;
}

function isFormComplete(f) {
  if (!String(f.first_name || "").trim() || !String(f.last_name || "").trim()) return false;
  if (!String(f.email || "").trim() || !String(f.mobile || "").trim()) return false;
  if (f.has_co_vendor === null) return false;
  if (f.has_co_vendor && !String(f.co_vendor_full_name || "").trim()) return false;
  if (!f.title_hold_type) return false;
  if ((f.title_hold_type === "company" || f.title_hold_type === "trust") && !String(f.entity_name || "").trim()) return false;
  if (f.has_mortgage === null) return false;
  if (f.has_mortgage && !String(f.lender_name || "").trim()) return false;
  if (!f.possession_type) return false;
  if (f.possession_type === "tenanted") {
    if (!String(f.tenant_name || "").trim() || !String(f.lease_expiry_date || "").trim() || !String(f.weekly_rent || "").trim()) return false;
  }
  if (f.building_works_last_7_years === null || f.owner_builder_work === null || f.has_pool_spa === null) return false;
  if (f.building_works_last_7_years && !String(f.building_works_details || "").trim()) return false;
  if (
    !String(f.agent_first_name || "").trim() ||
    !String(f.agent_last_name || "").trim() ||
    !String(f.agent_email || "").trim() ||
    !String(f.agent_phone || "").trim() ||
    !f.sale_method ||
    !String(f.expected_sale_price || "").trim()
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
        String(form.first_name || "").trim() &&
        String(form.last_name || "").trim() &&
        String(form.email || "").trim() &&
        String(form.mobile || "").trim()
      );
    }
    if (step === 1) {
      if (form.has_co_vendor === null) return false;
      if (form.has_co_vendor) {
        return String(form.co_vendor_full_name || "").trim().length > 0;
      }
      return true;
    }
    if (step === 2) {
      if (!form.title_hold_type) return false;
      if (form.title_hold_type === "company" || form.title_hold_type === "trust") {
        return String(form.entity_name || "").trim().length > 0;
      }
      return true;
    }
    if (step === 3) {
      if (form.has_mortgage === null) return false;
      if (form.has_mortgage) {
        return String(form.lender_name || "").trim().length > 0;
      }
      return true;
    }
    if (step === 4) {
      if (!form.possession_type) return false;
      if (form.possession_type === "tenanted") {
        return (
          String(form.tenant_name || "").trim() &&
          String(form.lease_expiry_date || "").trim() &&
          String(form.weekly_rent || "").trim()
        );
      }
      if (form.building_works_last_7_years === null || form.owner_builder_work === null || form.has_pool_spa === null) {
        return false;
      }
      if (form.building_works_last_7_years && !String(form.building_works_details || "").trim()) {
        return false;
      }
      return true;
    }
    if (step === 5) return true;
    if (step === 6) {
      return (
        String(form.agent_first_name || "").trim() &&
        String(form.agent_last_name || "").trim() &&
        String(form.agent_email || "").trim() &&
        String(form.agent_phone || "").trim() &&
        form.sale_method &&
        String(form.expected_sale_price || "").trim()
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
        body: JSON.stringify({ token, formData: buildPayload(form) }),
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

  const handleGoNext = async () => {
    if (!canGoNext || !token) return;
    const slice = stripLockedForApi(pickStepFormData(step, form));
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
  };

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
                  <input style={inputStyle} value={form.first_name} onChange={(e) => update({ first_name: e.target.value })} autoComplete="given-name" />
                </div>
                <div>
                  <label style={labelStyle}>Last name *</label>
                  <input style={inputStyle} value={form.last_name} onChange={(e) => update({ last_name: e.target.value })} autoComplete="family-name" />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Date of birth (optional)</label>
                <input type="date" style={inputStyle} value={form.date_of_birth} onChange={(e) => update({ date_of_birth: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Email *</label>
                <input type="email" style={inputStyle} value={form.email} onChange={(e) => update({ email: e.target.value })} autoComplete="email" inputMode="email" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Mobile *</label>
                <input type="tel" style={inputStyle} value={form.mobile} onChange={(e) => update({ mobile: e.target.value })} autoComplete="tel" inputMode="tel" />
              </div>
              <div>
                <label style={labelStyle}>Current address</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 88, resize: "vertical", lineHeight: 1.45 }}
                  value={form.current_address}
                  onChange={(e) => update({ current_address: e.target.value })}
                  placeholder="Street, suburb, state, postcode"
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Is there a co-owner of this property?</label>
              <ToggleYesNo value={form.has_co_vendor} onChange={(v) => update({ has_co_vendor: v })} style={{ marginBottom: 18 }} />
              {form.has_co_vendor && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Co-vendor full name *</label>
                    <input style={inputStyle} value={form.co_vendor_full_name} onChange={(e) => update({ co_vendor_full_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Co-vendor date of birth</label>
                    <input type="date" style={inputStyle} value={form.co_vendor_date_of_birth} onChange={(e) => update({ co_vendor_date_of_birth: e.target.value })} />
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
                    background: form.property_address_locked ? "#f8fafc" : "#fff",
                    color: form.property_address_locked ? MUTED : TEXT,
                  }}
                  value={form.property_address}
                  onChange={(e) => !form.property_address_locked && update({ property_address: e.target.value })}
                  readOnly={form.property_address_locked}
                  placeholder="Property being sold"
                />
                {form.property_address_locked && (
                  <p style={{ fontSize: 12, color: MUTED, margin: "8px 0 0" }}>Provided by your conveyancer — contact us if this needs changing.</p>
                )}
              </div>
              <label style={{ ...labelStyle, marginBottom: 10 }}>How do you hold title?</label>
              <TitleHoldButtons value={form.title_hold_type} onChange={(v) => update({ title_hold_type: v })} />
              {(form.title_hold_type === "company" || form.title_hold_type === "trust") && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Entity name *</label>
                    <input style={inputStyle} value={form.entity_name} onChange={(e) => update({ entity_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>ABN / ACN</label>
                    <input style={inputStyle} value={form.abn_acn} onChange={(e) => update({ abn_acn: e.target.value })} inputMode="numeric" />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Is there a mortgage on this property?</label>
              <ToggleYesNo value={form.has_mortgage} onChange={(v) => update({ has_mortgage: v })} style={{ marginBottom: 18 }} />
              {form.has_mortgage && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Lender name *</label>
                    <input style={inputStyle} value={form.lender_name} onChange={(e) => update({ lender_name: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Loan account number (optional)</label>
                    <input style={inputStyle} value={form.loan_account_number} onChange={(e) => update({ loan_account_number: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Estimated payout amount (optional)</label>
                    <input style={inputStyle} value={form.estimated_payout_amount} onChange={(e) => update({ estimated_payout_amount: e.target.value })} inputMode="decimal" placeholder="$" />
                  </div>
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Possession at settlement</label>
              <PossessionButtons value={form.possession_type} onChange={(v) => update({ possession_type: v })} />
              {form.possession_type === "tenanted" && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Tenant name *</label>
                    <input style={inputStyle} value={form.tenant_name} onChange={(e) => update({ tenant_name: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Lease expiry date *</label>
                    <input type="date" style={inputStyle} value={form.lease_expiry_date} onChange={(e) => update({ lease_expiry_date: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={labelStyle}>Weekly rent *</label>
                    <input style={inputStyle} value={form.weekly_rent} onChange={(e) => update({ weekly_rent: e.target.value })} inputMode="decimal" />
                  </div>
                </div>
              )}
              <label style={{ ...labelStyle, marginBottom: 10 }}>Any building works or permits in the last 7 years?</label>
              <ToggleYesNo value={form.building_works_last_7_years} onChange={(v) => update({ building_works_last_7_years: v })} style={{ marginBottom: 12 }} />
              {form.building_works_last_7_years && (
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Please describe *</label>
                  <textarea style={{ ...inputStyle, minHeight: 88 }} value={form.building_works_details} onChange={(e) => update({ building_works_details: e.target.value })} />
                </div>
              )}
              <label style={{ ...labelStyle, marginBottom: 10 }}>Was any work done by an owner builder?</label>
              <ToggleYesNo value={form.owner_builder_work} onChange={(v) => update({ owner_builder_work: v })} style={{ marginBottom: 18 }} />
              <label style={{ ...labelStyle, marginBottom: 10 }}>Is there a pool or spa?</label>
              <ToggleYesNo value={form.has_pool_spa} onChange={(v) => update({ has_pool_spa: v })} style={{ marginBottom: 18 }} />
              <label style={{ ...labelStyle, marginBottom: 10 }}>Are smoke alarms compliant?</label>
              <ToggleYesNo value={form.smoke_alarms_compliant} onChange={(v) => update({ smoke_alarms_compliant: v })} />
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
                  <input style={inputStyle} value={form.agent_first_name} onChange={(e) => update({ agent_first_name: e.target.value })} autoComplete="off" />
                </div>
                <div>
                  <label style={labelStyle}>Agent last name *</label>
                  <input style={inputStyle} value={form.agent_last_name} onChange={(e) => update({ agent_last_name: e.target.value })} autoComplete="off" />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Agency name</label>
                <input style={inputStyle} value={form.agency_name} onChange={(e) => update({ agency_name: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Agent phone *</label>
                <input type="tel" style={inputStyle} value={form.agent_phone} onChange={(e) => update({ agent_phone: e.target.value })} inputMode="tel" />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Agent email *</label>
                <input type="email" style={inputStyle} value={form.agent_email} onChange={(e) => update({ agent_email: e.target.value })} inputMode="email" />
              </div>
              <label style={{ ...labelStyle, marginBottom: 10 }}>Sale method *</label>
              <SaleMethodButtons value={form.sale_method} onChange={(v) => update({ sale_method: v })} />
              <div style={{ marginTop: 18 }}>
                <label style={labelStyle}>Expected sale price *</label>
                <input style={inputStyle} value={form.expected_sale_price} onChange={(e) => update({ expected_sale_price: e.target.value })} inputMode="decimal" placeholder="e.g. 850000" />
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Expected listing date (optional)</label>
                <input type="date" style={inputStyle} value={form.expected_listing_date} onChange={(e) => update({ expected_listing_date: e.target.value })} />
              </div>
            </>
          )}

          {step === 7 && (
            <>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Any special conditions or instructions for your conveyancer?</label>
                <textarea style={{ ...inputStyle, minHeight: 110, lineHeight: 1.45 }} value={form.special_conditions} onChange={(e) => update({ special_conditions: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Additional notes (optional)</label>
                <textarea style={{ ...inputStyle, minHeight: 88, lineHeight: 1.45 }} value={form.additional_notes} onChange={(e) => update({ additional_notes: e.target.value })} />
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
              ["Name", `${form.first_name} ${form.last_name}`.trim()],
              ["Date of birth", form.date_of_birth || "—"],
              ["Email", form.email || "—"],
              ["Mobile", form.mobile || "—"],
              ["Current address", form.current_address || "—"],
              [
                "Co-owner",
                form.has_co_vendor == null
                  ? "—"
                  : form.has_co_vendor
                    ? `Yes — ${form.co_vendor_full_name}${form.co_vendor_date_of_birth ? ` (DOB ${form.co_vendor_date_of_birth})` : ""}`
                    : "No",
              ],
              ["Property", form.property_address || "—"],
              ["Title held as", form.title_hold_type || "—"],
              [
                "Entity / ABN",
                (() => {
                  if (!form.entity_name && !form.abn_acn) return "—";
                  const parts = [form.entity_name, form.abn_acn].filter(Boolean);
                  return parts.join(" · ") || "—";
                })(),
              ],
              ["Mortgage", form.has_mortgage == null ? "—" : form.has_mortgage ? `Yes — ${form.lender_name}` : "No"],
              ["Possession", form.possession_type || "—"],
              ["Tenancy details", form.possession_type === "tenanted" ? `${form.tenant_name}, expires ${form.lease_expiry_date}, ${form.weekly_rent}/wk` : "—"],
              ["Building works (7 yrs)", form.building_works_last_7_years == null ? "—" : form.building_works_last_7_years ? form.building_works_details : "No"],
              ["Owner builder work", form.owner_builder_work == null ? "—" : form.owner_builder_work ? "Yes" : "No"],
              ["Pool / spa", form.has_pool_spa == null ? "—" : form.has_pool_spa ? "Yes" : "No"],
              ["Smoke alarms compliant", form.smoke_alarms_compliant ? "Yes" : "No"],
              ["Inclusions", form.inclusions || "—"],
              ["Exclusions", form.exclusions || "—"],
              ["Agent", `${form.agent_first_name} ${form.agent_last_name}`.trim()],
              ["Agency", form.agency_name || "—"],
              ["Agent contact", `${form.agent_phone} · ${form.agent_email}`],
              ["Sale method", form.sale_method === "auction" ? "Auction" : form.sale_method === "private_treaty" ? "Private Treaty" : "—"],
              ["Expected price", form.expected_sale_price || "—"],
              ["Listing date", form.expected_listing_date || "—"],
              ["Special conditions", form.special_conditions || "—"],
              ["Notes", form.additional_notes || "—"],
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
