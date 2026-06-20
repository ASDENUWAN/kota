// ============================================================
// server.js – AeroKnow Safety Report BACKEND with MongoDB
// Email sending: Brevo Transactional Email API
//
// What this file does:
//   1. Accepts form data from React
//   2. Saves form data to MongoDB Atlas
//   3. Sends email links using Brevo
//   4. Loads saved reports by ID
//   5. Updates reports for manager / committee
//   6. Generates and downloads PDF using Puppeteer
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");

const app = express();

// ============================================================
// BASIC CONFIG
// ============================================================

const PORT = process.env.PORT || 5001;

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const CORS_ORIGIN = process.env.CORS_ORIGIN || CLIENT_URL;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "aeroknow_safety";

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "sachinthaakarawita@gmail.com";
const EMAIL_FROM_NAME =
  process.env.EMAIL_FROM_NAME || "AeroKnow Safety Reports";

const RECIPIENTS = {
  SAFETY_MANAGER: process.env.SAFETY_MANAGER_EMAIL || "ishananjana20@gmail.com",
  SAFETY_COMMITTEE:
    process.env.SAFETY_COMMITTEE_EMAIL || "ishananjana22@gmail.com",
};

// ============================================================
// CORS CONFIG
// ============================================================

function cleanOrigin(origin) {
  if (!origin) return "";
  return origin.trim().replace(/\/$/, "");
}

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  cleanOrigin(CLIENT_URL),
  cleanOrigin(CORS_ORIGIN),
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const cleanedOrigin = cleanOrigin(origin);

    if (allowedOrigins.includes(cleanedOrigin)) {
      return callback(null, true);
    }

    console.log("Blocked by CORS:", cleanedOrigin);
    console.log("Allowed origins:", allowedOrigins);

    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

// ============================================================
// MONGODB CONNECTION
// ============================================================

let cachedClient = null;
let cachedDb = null;

async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in environment variables");
  }

  if (cachedClient && cachedDb) {
    return cachedDb;
  }

  cachedClient = new MongoClient(MONGODB_URI);
  await cachedClient.connect();

  cachedDb = cachedClient.db(MONGODB_DB_NAME);

  await cachedDb.collection("reports").createIndex({ createdAt: -1 });

  return cachedDb;
}

async function getReportsCollection() {
  const db = await connectDB();
  return db.collection("reports");
}

// ============================================================
// BREVO EMAIL SETUP
// ============================================================

function normalizeRecipients(to) {
  const recipients = Array.isArray(to) ? to : [to];

  return recipients
    .filter(Boolean)
    .map((email) => String(email).trim())
    .filter((email) => email.includes("@"))
    .map((email) => ({ email }));
}

async function sendEmail({ to, subject, html }) {
  if (!BREVO_API_KEY) {
    console.log("BREVO_API_KEY missing. Email not sent.");
    console.log("Email would send to:", to);
    console.log("Subject:", subject);
    return;
  }

  const recipients = normalizeRecipients(to);

  if (recipients.length === 0) {
    console.log("No valid email recipients. Email not sent.");
    return;
  }

  const payload = {
    sender: {
      name: EMAIL_FROM_NAME,
      email: EMAIL_FROM,
    },
    to: recipients,
    subject,
    htmlContent: html,
  };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error("Brevo email failed:", response.status, responseText);
    throw new Error(`Brevo email failed: ${response.status} ${responseText}`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

// ============================================================
// SMALL SECURITY HELPERS FOR PDF HTML / EMAIL HTML
// ============================================================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function field(form, name) {
  return escapeHtml(form?.[name] || "");
}

function selectedScale(form, name, number) {
  return String(number) === String(form?.[name] || "") ? "selected" : "";
}

function safeFileName(value) {
  return String(value || "Draft").replace(/[^a-z0-9-_]/gi, "_");
}

// ============================================================
// EMAIL TEMPLATES
// ============================================================

function managerEmailTemplate({ form, managerLink }) {
  const reporterName = escapeHtml(form.reporterName || "client");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
      <h2 style="color: #0077b6;">AeroKnow Safety Report</h2>

      <p>Dear Safety Manager,</p>

      <p>A new safety report has been submitted by <strong>${reporterName}</strong>.</p>

      <p>Please click the button below to review Part A and complete Part B.</p>

      <p style="margin: 24px 0;">
        <a href="${managerLink}"
           style="background: #0077b6; color: #ffffff; padding: 12px 18px;
                  text-decoration: none; border-radius: 4px; display: inline-block;">
          Open Safety Report
        </a>
      </p>

      <p>If the button does not work, copy and paste this link into your browser:</p>
      <p><a href="${managerLink}">${managerLink}</a></p>

      <hr />

      <p style="font-size: 12px; color: #555;">
        This is an automated email from AeroKnow Safety Reports.
      </p>
    </div>
  `;
}

function committeeEmailTemplate({ committeeLink }) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
      <h2 style="color: #0077b6;">AeroKnow Safety Report</h2>

      <p>Dear Safety Committee,</p>

      <p>The Safety Manager has completed Part B of a Safety Report.</p>

      <p>Please click the button below to review Parts A and B, then complete Part C.</p>

      <p style="margin: 24px 0;">
        <a href="${committeeLink}"
           style="background: #0077b6; color: #ffffff; padding: 12px 18px;
                  text-decoration: none; border-radius: 4px; display: inline-block;">
          Complete Part C
        </a>
      </p>

      <p>If the button does not work, copy and paste this link into your browser:</p>
      <p><a href="${committeeLink}">${committeeLink}</a></p>

      <hr />

      <p style="font-size: 12px; color: #555;">
        This is an automated email from AeroKnow Safety Reports.
      </p>
    </div>
  `;
}

// ============================================================
// generateHTML(form)
// Builds the full PDF HTML.
// ============================================================

function generateHTML(form) {
  const logoPath = path.join(__dirname, "images", "footerlogo.png");

  let logoSrc = "";
  if (fs.existsSync(logoPath)) {
    const logoBase64 = fs.readFileSync(logoPath, "base64");
    logoSrc = `data:image/png;base64,${logoBase64}`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <style>
        body {
            font-family: Verdana, sans-serif;
            font-size: 12pt;
            line-height: 1.5;
            color: #000;
            margin: 0;
            padding: 0;
        }

        .form-container {
            width: 100%;
            margin: 0 auto;
        }

        .form-header {
            margin-bottom: 20px;
        }

        .header-logo {
            margin-bottom: 10px;
            display: flex;
            align-items: baseline;
        }

        .header-easa {
            font-size: 14px;
            font-weight: bold;
            border-bottom: 2px solid #000;
            padding-bottom: 4px;
        }

        .header-title-bar {
            display: flex;
            justify-content: space-between;
            margin-top: 4px;
            font-size: 14px;
        }

        .header-title {
            font-weight: bold;
        }

        .header-meta {
            font-size: 12px;
        }

        .form-main-title {
            text-align: center;
            font-size: 18px;
            font-weight: bold;
            margin: 20px 0;
        }

        .section-title {
            font-size: 14px;
            font-weight: bold;
            margin-top: 20px;
            margin-bottom: 10px;
        }

        .section-note {
            margin-bottom: 15px;
            font-size: 14px;
        }

        .form-row {
            display: flex;
            align-items: baseline;
            margin-bottom: 15px;
            width: 100%;
        }

        .val {
            flex-grow: 1;
            border-bottom: 1px dotted #000;
            margin-left: 5px;
            min-width: 50px;
            display: inline-block;
            padding-bottom: 2px;
        }

        .textarea-box {
            border: 1px solid #000;
            min-height: 150px;
            padding: 10px;
            margin-top: 5px;
            white-space: pre-wrap;
        }

        .scale-question {
            margin-bottom: 5px;
        }

        .scale-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .scale-label {
            flex: 1;
        }

        .scale-label.right {
            text-align: right;
        }

        .scale-numbers {
            display: flex;
            justify-content: space-between;
            flex: 2;
            padding: 0 20px;
        }

        .scale-num {
            width: 20px;
            text-align: center;
            font-weight: bold;
        }

        .scale-num.selected {
            border: 1px solid #000;
            border-radius: 50%;
        }

        .agreed-row {
            display: flex;
            align-items: baseline;
            margin-bottom: 10px;
        }

        .agreed-role {
            width: 250px;
        }
    </style>
</head>

<body>
    <div class="form-container">

        <div class="form-header">
            <div class="header-logo" style="margin-top: 0.25in;">
                ${
                  logoSrc
                    ? `<img src="${logoSrc}" alt="AeroKnow Logo" style="width: 150px;" />`
                    : ""
                }
            </div>
            <div class="header-easa">EASA.21J.791/LV.21G.0001</div>
            <div class="header-title-bar">
                <span class="header-title">AK – 2311 SAFETY REPORTING</span>
                <span class="header-meta">Issue:1 &nbsp;&nbsp; Date:01/05/2023</span>
            </div>
        </div>

        <div class="form-main-title">Safety Report Form Template</div>

        <div class="section-title">Part A to be completed by the person identifying the event or hazard.</div>

        <div class="form-row">
            <span>Date of event:</span>
            <span class="val">${field(form, "dateOfEvent")}</span>
            <span style="margin-left: 20px;">Local time:</span>
            <span class="val">${field(form, "localTime")}</span>
        </div>

        <div class="form-row">
            <span>Location:</span>
            <span class="val">${field(form, "location")}</span>
        </div>

        <div class="form-row">
            <span>Name of reporter:(Not mandatory)</span>
            <span class="val">${field(form, "reporterName")}</span>
            <span style="margin-left: 20px;">Dept/Organization:</span>
            <span class="val">${field(form, "department")}</span>
        </div>

        <div style="font-weight: bold; margin-top: 20px;">
            Please fully describe the event or identified hazard:
        </div>

        <div style="font-size: 13px; margin-bottom: 5px;">
            Include your suggestions on how to prevent similar occurrences.
        </div>

        <div class="textarea-box">${field(form, "eventDescription")}</div>

        <br/>

        <div class="scale-question">
            In your opinion, what is the likelihood of such an event or similar happening or happening again?
        </div>

        <div class="scale-row">
            <span class="scale-label">Extremely improbable</span>
            <div class="scale-numbers">
                <span class="scale-num ${selectedScale(form, "likelihood", 1)}">1</span>
                <span class="scale-num ${selectedScale(form, "likelihood", 2)}">2</span>
                <span class="scale-num ${selectedScale(form, "likelihood", 3)}">3</span>
                <span class="scale-num ${selectedScale(form, "likelihood", 4)}">4</span>
                <span class="scale-num ${selectedScale(form, "likelihood", 5)}">5</span>
            </div>
            <span class="scale-label right">Frequent</span>
        </div>

        <br/>

        <div class="scale-question">
            What do you consider could be the worst possible consequence if this event did happen or happened again?
        </div>

        <div class="scale-row">
            <span class="scale-label">Negligible</span>
            <div class="scale-numbers">
                <span class="scale-num ${selectedScale(form, "consequence", 1)}">1</span>
                <span class="scale-num ${selectedScale(form, "consequence", 2)}">2</span>
                <span class="scale-num ${selectedScale(form, "consequence", 3)}">3</span>
                <span class="scale-num ${selectedScale(form, "consequence", 4)}">4</span>
                <span class="scale-num ${selectedScale(form, "consequence", 5)}">5</span>
            </div>
            <span class="scale-label right">Catastrophic</span>
        </div>

        <div class="section-title">Part B to be completed by the Safety Manager</div>

        <div class="section-note">
            The report has been dis-identified and entered into the company database.
        </div>

        <div class="form-row">
            <span>Report reference:</span>
            <span class="val">${field(form, "reportReference")}</span>
        </div>

        <div class="form-row">
            <span>Signature:</span>
            <span class="val" style="flex: 2;">${field(form, "signatureB")}</span>
            <span style="margin-left: 20px;">Date:</span>
            <span class="val" style="flex: 1;">${field(form, "dateB")}</span>
        </div>

        <div class="form-row">
            <span>Name:</span>
            <span class="val">${field(form, "nameB")}</span>
        </div>

        <div class="section-title">Part C to be completed by the Safety Committee</div>

        <div class="scale-question">
            Rate the likelihood of the event occurring or recurring.
        </div>

        <div class="scale-row">
            <span class="scale-label">Extremely improbable</span>
            <div class="scale-numbers">
                <span class="scale-num ${selectedScale(form, "likelihoodC", 1)}">1</span>
                <span class="scale-num ${selectedScale(form, "likelihoodC", 2)}">2</span>
                <span class="scale-num ${selectedScale(form, "likelihoodC", 3)}">3</span>
                <span class="scale-num ${selectedScale(form, "likelihoodC", 4)}">4</span>
                <span class="scale-num ${selectedScale(form, "likelihoodC", 5)}">5</span>
            </div>
            <span class="scale-label right">Frequent</span>
        </div>

        <br/>

        <div class="scale-question">Rate the worst-case consequences?</div>

        <div class="scale-row">
            <span class="scale-label">Negligible</span>
            <div class="scale-numbers">
                <span class="scale-num ${selectedScale(form, "consequenceC", 1)}">1</span>
                <span class="scale-num ${selectedScale(form, "consequenceC", 2)}">2</span>
                <span class="scale-num ${selectedScale(form, "consequenceC", 3)}">3</span>
                <span class="scale-num ${selectedScale(form, "consequenceC", 4)}">4</span>
                <span class="scale-num ${selectedScale(form, "consequenceC", 5)}">5</span>
            </div>
            <span class="scale-label right">Catastrophic</span>
        </div>

        <br/>

        <div>
            What action or actions are required to ELIMINATE, MITIGATE or<br/>
            CONTROL the hazard to an acceptable level of safety?
        </div>

        <div class="textarea-box" style="min-height: 100px;">
            ${field(form, "actionRequired")}
        </div>

        <br/>

        <div class="form-row">
            <span>Resource required:</span>
            <span class="val">${field(form, "resourceRequired")}</span>
        </div>

        <div class="form-row">
            <span>Responsibility for Action:</span>
            <span class="val">${field(form, "responsibility")}</span>
        </div>

        <br/>

        <div class="agreed-row">
            <div class="agreed-role">Agreed and Accepted by,</div>
            <div class="agreed-role">Safety Manager</div>
            <span>Date:</span>
            <span class="val">${field(form, "safetyManagerDate")}</span>
        </div>

        <div class="agreed-row">
            <div class="agreed-role"></div>
            <div class="agreed-role">Responsible Manager</div>
            <span>Date:</span>
            <span class="val">${field(form, "responsibleManagerDate")}</span>
        </div>

        <div class="agreed-row">
            <div class="agreed-role"></div>
            <div class="agreed-role">Accountable Manager</div>
            <span>Date:</span>
            <span class="val">${field(form, "accountableManagerDate")}</span>
        </div>

        <br/>

        <div class="agreed-row">
            <div style="flex: 2;">
                Appropriate Feedback given to staff by Safety Manager<br/>
                Signed
            </div>
            <span style="margin-left: 20px;">Date:</span>
            <span class="val">${field(form, "feedbackDate")}</span>
        </div>

        <br/>

        <div class="agreed-row">
            <div style="width: 200px;">Follow up action required:</div>
            <span>When</span>
            <span class="val">${field(form, "followUpWhen")}</span>
            <span style="margin-left: 20px;">Who</span>
            <span class="val">${field(form, "followUpWho")}</span>
        </div>

        <div class="agreed-row">
            <div style="width: 200px;">Hazard log updated:</div>
            <span>When</span>
            <span class="val">${field(form, "hazardLogWhen")}</span>
        </div>

    </div>
</body>
</html>
  `;
}

// ============================================================
// ROUTE 1: POST /api/reports
// Client submits Part A
// Saves report to MongoDB and emails manager link
// ============================================================

app.post("/api/reports", async (req, res) => {
  try {
    const id = uuidv4();
    const form = req.body || {};

    const reports = await getReportsCollection();

    await reports.insertOne({
      _id: id,
      data: form,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const managerLink = `${CLIENT_URL}/?id=${id}&role=manager`;

    const mailRecipients = [RECIPIENTS.SAFETY_MANAGER];

    if (form.reporterEmail && String(form.reporterEmail).includes("@")) {
      mailRecipients.push(form.reporterEmail);
    }

    await sendEmail({
      to: mailRecipients,
      subject: `New feedback safety report comes from ${
        form.reporterName || "client"
      }`,
      html: managerEmailTemplate({ form, managerLink }),
    });

    res.status(200).json({
      success: true,
      id,
      message: "Report saved and email sent to Manager",
    });
  } catch (error) {
    console.error("POST /api/reports error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ============================================================
// ROUTE 2: GET /api/reports/:id
// Manager or committee opens email link
// Loads report from MongoDB
// ============================================================

app.get("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const reports = await getReportsCollection();

    const report = await reports.findOne({ _id: id });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    res.status(200).json({
      success: true,
      data: report.data,
    });
  } catch (error) {
    console.error("GET /api/reports/:id error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ============================================================
// ROUTE 3: PUT /api/reports/:id?role=manager OR ?role=committee
// Manager fills Part B, committee fills Part C
// Saves updated report to MongoDB
// ============================================================

app.put("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.query;
    const updatedForm = req.body || {};

    const reports = await getReportsCollection();

    const existingReport = await reports.findOne({ _id: id });

    if (!existingReport) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    await reports.updateOne(
      { _id: id },
      {
        $set: {
          data: updatedForm,
          updatedAt: new Date(),
        },
      },
    );

    if (role === "manager") {
      const committeeLink = `${CLIENT_URL}/?id=${id}&role=committee`;

      await sendEmail({
        to: RECIPIENTS.SAFETY_COMMITTEE,
        subject: "AeroKnow Safety Report - Action Required Part C",
        html: committeeEmailTemplate({ committeeLink }),
      });

      return res.status(200).json({
        success: true,
        message: "Report updated and email sent to Committee",
      });
    }

    if (role === "committee") {
      return res.status(200).json({
        success: true,
        message: "Final report saved successfully",
      });
    }

    res.status(200).json({
      success: true,
      message: "Report updated",
    });
  } catch (error) {
    console.error("PUT /api/reports/:id error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ============================================================
// ROUTE 4: POST /api/reports/:id/pdf
// Generates PDF from current form state or saved MongoDB data
// ============================================================

app.post("/api/reports/:id/pdf", async (req, res) => {
  let browser;

  try {
    const { id } = req.params;

    const reports = await getReportsCollection();

    const report = await reports.findOne({ _id: id });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    const form =
      Object.keys(req.body || {}).length > 0 ? req.body : report.data;

    const html = generateHTML(form);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    const pdfUint8Array = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0.25in",
        bottom: "1in",
        left: "1in",
        right: "0.25in",
      },
    });

    const pdfBuffer = Buffer.from(pdfUint8Array);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="AeroKnow_Safety_Report_${safeFileName(
        form.dateOfEvent,
      )}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error("PDF generation error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// ============================================================
// ROUTE 5: GET /api/health
// Health check
// ============================================================

app.get("/api/health", async (req, res) => {
  try {
    await connectDB();

    res.json({
      status: "Server is running",
      database: "MongoDB connected",
      brevo: BREVO_API_KEY ? "Configured" : "Missing",
      emailFrom: EMAIL_FROM,
      emailFromName: EMAIL_FROM_NAME,
      clientUrl: CLIENT_URL,
      corsOrigin: CORS_ORIGIN,
      allowedOrigins,
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: "Server running but database failed",
      error: error.message,
      brevo: BREVO_API_KEY ? "Configured" : "Missing",
      emailFrom: EMAIL_FROM,
      emailFromName: EMAIL_FROM_NAME,
      clientUrl: CLIENT_URL,
      corsOrigin: CORS_ORIGIN,
      allowedOrigins,
      time: new Date().toISOString(),
    });
  }
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log("====================================");
  console.log("  AeroKnow Safety Report Server");
  console.log("  Port:", PORT);
  console.log("  Client URL:", CLIENT_URL);
  console.log("  CORS Origin:", CORS_ORIGIN);
  console.log("  Brevo:", BREVO_API_KEY ? "Configured" : "Missing");
  console.log("  Email From:", EMAIL_FROM);
  console.log("  Allowed Origins:", allowedOrigins);
  console.log("====================================");
});
