import { useState, useEffect } from "react";
import logoImg from "../images/footerlogo.png";

// ====================================================
//  IMPORTANT: Update this to your deployed client URL
//  For local dev, this is automatically http://localhost:5173
// ====================================================
const API_BASE = "https://kota-c4fd.onrender.com/api";

// -------------------------------------------------------
// SafetyForm Component
// - Reads ?id=...&role=... from URL to determine mode
// - Role "client"    -> Part A editable, B & C hidden
// - Role "manager"   -> Part A read-only, B editable, C visible (read-only)
// - Role "committee" -> Part A & B read-only, C editable
// -------------------------------------------------------
function SafetyForm() {
  // Parse URL query params on load
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("id"); // UUID of existing report
  const role = params.get("role") || "client"; // "client" | "manager" | "committee"

  const emptyForm = {
    dateOfEvent: "",
    localTime: "",
    location: "",
    reporterName: "",
    reporterEmail: "",
    department: "",
    eventDescription: "",
    likelihood: "",
    consequence: "",
    reportReference: "",
    signatureB: "",
    dateB: "",
    nameB: "",
    likelihoodC: "",
    consequenceC: "",
    actionRequired: "",
    resourceRequired: "",
    responsibility: "",
    safetyManagerDate: "",
    responsibleManagerDate: "",
    accountableManagerDate: "",
    feedbackDate: "",
    followUpWhen: "",
    followUpWho: "",
    hazardLogWhen: "",
  };

  const [formData, setFormData] = useState(emptyForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // "success" | "error"
  const [statusMessage, setStatusMessage] = useState("");

  // -------------------------------------------------------
  // On mount: if a reportId is in the URL, fetch form data
  // -------------------------------------------------------
  useEffect(() => {
    if (reportId) {
      setIsLoading(true);
      fetch(`${API_BASE}/reports/${reportId}`)
        .then((res) => res.json())
        .then((result) => {
          if (result.success) {
            setFormData(result.data);
          } else {
            setSubmitStatus("error");
            setStatusMessage("Report not found. The link may be invalid.");
          }
        })
        .catch(() => {
          setSubmitStatus("error");
          setStatusMessage(
            "Failed to load report. Please check your connection.",
          );
        })
        .finally(() => setIsLoading(false));
    }
  }, [reportId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // -------------------------------------------------------
  // Submit logic depending on role
  // -------------------------------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      let response;
      if (role === "client") {
        // POST new report -> email goes to Safety Manager
        response = await fetch(`${API_BASE}/reports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
      } else if (role === "manager") {
        // PUT update -> email goes to Safety Committee
        response = await fetch(`${API_BASE}/reports/${reportId}?role=manager`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
      } else if (role === "committee") {
        // PUT final update -> saves final form
        response = await fetch(
          `${API_BASE}/reports/${reportId}?role=committee`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData),
          },
        );
      }

      const result = await response.json();
      if (result.success) {
        setSubmitStatus("success");
        setStatusMessage(result.message || "Submitted successfully!");
        if (role === "client") {
          setFormData(emptyForm); // Reset form for client after submit
        }
      } else {
        setSubmitStatus("error");
        setStatusMessage(result.message || "Submission failed.");
      }
    } catch (error) {
      setSubmitStatus("error");
      setStatusMessage("Network error. Please check your connection.");
    }

    setIsSubmitting(false);
  };

  // -------------------------------------------------------
  // Download PDF (for Safety Manager)
  // -------------------------------------------------------
  const handleDownloadPDF = async () => {
    if (!reportId) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/reports/${reportId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData), // Pass current form state
      });

      if (!response.ok) throw new Error("PDF generation failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AeroKnow_Safety_Report_${formData.dateOfEvent || "Draft"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setSubmitStatus("error");
      setStatusMessage("Failed to generate PDF.");
    }
    setIsSubmitting(false);
  };

  // -------------------------------------------------------
  // Render a 1-5 scale input row
  // isReadOnly = render as static highlighted number, not radio button
  // -------------------------------------------------------
  const renderScale = (name, leftLabel, rightLabel, isReadOnly = false) => (
    <div className="scale-container">
      <div className="scale-row">
        <div className="scale-label">{leftLabel}</div>
        <div className="scale-numbers">
          {[1, 2, 3, 4, 5].map((num) => {
            const isSelected = formData[name] === String(num);
            return isReadOnly ? (
              <span
                key={num}
                className={`scale-num-display${isSelected ? " selected" : ""}`}
              >
                {num}
              </span>
            ) : (
              <label key={num} className="scale-option">
                <span>{num}</span>
                <input
                  type="radio"
                  name={name}
                  value={num}
                  checked={isSelected}
                  onChange={handleChange}
                  required
                />
              </label>
            );
          })}
        </div>
        <div className="scale-label right">{rightLabel}</div>
      </div>
    </div>
  );

  // -------------------------------------------------------
  // Role-based visibility flags
  // -------------------------------------------------------
  const isPartAReadOnly = role === "manager" || role === "committee";
  const showPartB = role === "manager" || role === "committee";
  const isPartBReadOnly = role === "committee";
  const showPartC = role === "committee";

  // -------------------------------------------------------
  // Role label for UI
  // -------------------------------------------------------
  const roleLabel =
    {
      client: "Client",
      manager: "Safety Manager",
      committee: "Safety Committee",
    }[role] || "Client";

  // -------------------------------------------------------
  // Loading state
  // -------------------------------------------------------
  if (isLoading) {
    return (
      <div className="app-wrapper">
        <div
          className="form-container"
          style={{ textAlign: "center", paddingTop: "40px" }}
        >
          <p>Loading report data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <div className="form-container">
        {/* HEADER */}
        <header className="form-header">
          <div className="header-logo" style={{ marginTop: "0.25in" }}>
            <img src={logoImg} alt="AeroKnow Logo" style={{ width: "150px" }} />
          </div>
          <div className="header-easa">EASA.21J.791/LV.21G.0001</div>
          <div className="header-title-bar">
            <span className="header-title">AK – 2311 SAFETY REPORTING</span>
            <span className="header-meta">
              Issue:1 &nbsp;&nbsp; Date:01/05/2023
            </span>
          </div>
        </header>

        <h1 className="form-main-title">Safety Report Form Template</h1>

        {/* STATUS MESSAGES */}
        {submitStatus === "success" && (
          <div className="status-message success">{statusMessage}</div>
        )}
        {submitStatus === "error" && (
          <div className="status-message error">{statusMessage}</div>
        )}

        <form onSubmit={handleSubmit}>
          {/* ==================== PART A ==================== */}
          <section className="form-section">
            <h2 className="section-title">
              Part A to be completed by the person identifying the event or
              hazard.
            </h2>

            {isPartAReadOnly && (
              <div className="readonly-notice">Part A is read-only.</div>
            )}

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Date of event:</label>
                <input
                  type="date"
                  name="dateOfEvent"
                  value={formData.dateOfEvent}
                  onChange={handleChange}
                  required={!isPartAReadOnly}
                  disabled={isPartAReadOnly}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Local time:</label>
                <input
                  type="time"
                  name="localTime"
                  value={formData.localTime}
                  onChange={handleChange}
                  required={!isPartAReadOnly}
                  disabled={isPartAReadOnly}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Location:</label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  required={!isPartAReadOnly}
                  disabled={isPartAReadOnly}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Name of reporter: (Not mandatory)</label>
                <input
                  type="text"
                  name="reporterName"
                  value={formData.reporterName}
                  onChange={handleChange}
                  disabled={isPartAReadOnly}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Dept/Organization:</label>
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  required={!isPartAReadOnly}
                  disabled={isPartAReadOnly}
                />
              </div>
            </div>

            {/* Reporter email only shown to client */}
            {role === "client" && (
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Your Email (optional – to receive a copy):</label>
                  <input
                    type="email"
                    name="reporterEmail"
                    value={formData.reporterEmail}
                    onChange={handleChange}
                    placeholder="your@email.com"
                  />
                </div>
              </div>
            )}

            <div
              className="form-group"
              style={{ display: "block", marginRight: 0, marginBottom: "20px" }}
            >
              <label style={{ fontWeight: "bold" }}>
                Please fully describe the event or identified hazard:
              </label>
              <div style={{ fontSize: "13px", marginBottom: "5px" }}>
                Include your suggestions on how to prevent similar occurrences.
              </div>
              <textarea
                name="eventDescription"
                value={formData.eventDescription}
                onChange={handleChange}
                required={!isPartAReadOnly}
                disabled={isPartAReadOnly}
              />
            </div>

            <div className="scale-question">
              In your opinion, what is the likelihood of such an event or
              similar happening or happening again?
            </div>
            {renderScale(
              "likelihood",
              "Extremely improbable",
              "Frequent",
              isPartAReadOnly,
            )}

            <div className="scale-question">
              What do you consider could be the worst possible consequence if
              this event did happen or happened again?
            </div>
            {renderScale(
              "consequence",
              "Negligible",
              "Catastrophic",
              isPartAReadOnly,
            )}
          </section>

          {/* ==================== PART B ==================== */}
          {showPartB && (
            <section className="form-section">
              <h2 className="section-title">
                Part B to be completed by the Safety Manager
              </h2>
              <div className="section-note">
                The report has been dis-identified and entered into the company
                database.
              </div>

              {isPartBReadOnly && (
                <div className="readonly-notice">Part B is read-only.</div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Report reference:</label>
                  <input
                    type="text"
                    name="reportReference"
                    value={formData.reportReference}
                    onChange={handleChange}
                    disabled={isPartBReadOnly}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Signature:</label>
                  <input
                    type="text"
                    name="signatureB"
                    value={formData.signatureB}
                    onChange={handleChange}
                    disabled={isPartBReadOnly}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Date:</label>
                  <input
                    type="date"
                    name="dateB"
                    value={formData.dateB}
                    onChange={handleChange}
                    disabled={isPartBReadOnly}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Name:</label>
                  <input
                    type="text"
                    name="nameB"
                    value={formData.nameB}
                    onChange={handleChange}
                    disabled={isPartBReadOnly}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ==================== PART C ==================== */}
          {showPartC && (
            <section className="form-section">
              <h2 className="section-title">
                Part C to be completed by the Safety Committee
              </h2>

              <div className="scale-question">
                Rate the likelihood of the event occurring or recurring.
              </div>
              {renderScale(
                "likelihoodC",
                "Extremely improbable",
                "Frequent",
                false,
              )}

              <div className="scale-question">
                Rate the worst-case consequences?
              </div>
              {renderScale("consequenceC", "Negligible", "Catastrophic", false)}

              <div
                className="form-group"
                style={{
                  display: "block",
                  marginRight: 0,
                  marginBottom: "20px",
                }}
              >
                <label>
                  What action or actions are required to ELIMINATE, MITIGATE or
                  <br />
                  CONTROL the hazard to an acceptable level of safety?
                </label>
                <textarea
                  name="actionRequired"
                  value={formData.actionRequired}
                  onChange={handleChange}
                  style={{ minHeight: "100px" }}
                />
              </div>

              <div className="form-row">
                <div className="form-group" style={{ width: "100%" }}>
                  <label>Resource required:</label>
                  <input
                    type="text"
                    name="resourceRequired"
                    value={formData.resourceRequired}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ width: "100%" }}>
                  <label>Responsibility for Action:</label>
                  <input
                    type="text"
                    name="responsibility"
                    value={formData.responsibility}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div style={{ margin: "20px 0" }}>
                <div className="agreed-row">
                  <div className="agreed-role">Agreed and Accepted by,</div>
                  <div className="agreed-role">Safety Manager</div>
                  <div className="agreed-date">
                    <label>Date:</label>
                    <input
                      type="date"
                      name="safetyManagerDate"
                      value={formData.safetyManagerDate}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="agreed-row">
                  <div className="agreed-role"></div>
                  <div className="agreed-role">Responsible Manager</div>
                  <div className="agreed-date">
                    <label>Date:</label>
                    <input
                      type="date"
                      name="responsibleManagerDate"
                      value={formData.responsibleManagerDate}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="agreed-row">
                  <div className="agreed-role"></div>
                  <div className="agreed-role">Accountable Manager</div>
                  <div className="agreed-date">
                    <label>Date:</label>
                    <input
                      type="date"
                      name="accountableManagerDate"
                      value={formData.accountableManagerDate}
                      onChange={handleChange}
                    />
                  </div>
                </div>
              </div>

              <div className="agreed-row" style={{ marginTop: "20px" }}>
                <div style={{ flex: 2 }}>
                  Appropriate Feedback given to staff by Safety Manager
                  <br />
                  Signed
                </div>
                <div className="agreed-date" style={{ flex: 1 }}>
                  <label>Date:</label>
                  <input
                    type="date"
                    name="feedbackDate"
                    value={formData.feedbackDate}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="agreed-row" style={{ marginTop: "20px" }}>
                <div style={{ width: "200px" }}>Follow up action required:</div>
                <div style={{ flex: 1, display: "flex", gap: "20px" }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>When</label>
                    <input
                      type="text"
                      name="followUpWhen"
                      value={formData.followUpWhen}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Who</label>
                    <input
                      type="text"
                      name="followUpWho"
                      value={formData.followUpWho}
                      onChange={handleChange}
                    />
                  </div>
                </div>
              </div>

              <div className="agreed-row" style={{ marginTop: "10px" }}>
                <div style={{ width: "200px" }}>Hazard log updated:</div>
                <div className="form-group" style={{ margin: 0, flex: 1 }}>
                  <label>When</label>
                  <input
                    type="text"
                    name="hazardLogWhen"
                    value={formData.hazardLogWhen}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ==================== BUTTONS ==================== */}
          <div className="submit-wrapper">
            {role === "client" && (
              <button
                type="submit"
                className="submit-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit Part A"}
              </button>
            )}
            {role === "manager" && (
              <div className="btn-group">
                <button
                  type="button"
                  className="submit-btn btn-secondary"
                  disabled={isSubmitting}
                  onClick={handleDownloadPDF}
                >
                  {isSubmitting ? "Generating..." : "⬇ Download as PDF"}
                </button>
                <button
                  type="submit"
                  className="submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? "Submitting..."
                    : "Submit Part B → Safety Committee"}
                </button>
              </div>
            )}
            {role === "committee" && (
              <button
                type="submit"
                className="submit-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit Final Report"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default SafetyForm;
