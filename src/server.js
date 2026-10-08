import dotenv from "dotenv";
dotenv.config({ override: true }); // our .env wins over any stray exported shell vars (e.g. GOOGLE_API_KEY)
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import candidateRoutes from "./routes/candidates.js";
import employeeRoutes from "./routes/employees.js";
import noteRoutes from "./routes/notes.js";
import fileRoutes from "./routes/files.js";
import chatRoutes from "./routes/chat.js";
import dashboardRoutes from "./routes/dashboard.js";
import sheetRoutes from "./routes/sheets.js";
import googleRoutes from "./routes/google.js";
import leaveRequestRoutes from "./routes/leaveRequests.js";
import holidayRoutes from "./routes/holidays.js";
import auditLogRoutes from "./routes/auditlog.js";
import jobRoutes from "./routes/jobs.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);

app.use("/api/candidates", requireAuth, candidateRoutes);
app.use("/api/employees", requireAuth, employeeRoutes);
app.use("/api/notes", requireAuth, noteRoutes);
app.use("/api/files", requireAuth, fileRoutes);
app.use("/api/chat", requireAuth, chatRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/sheets", requireAuth, sheetRoutes);
app.use("/api/google", googleRoutes);
app.use("/api/leave-requests", leaveRequestRoutes);
app.use("/api/holidays", requireAuth, holidayRoutes);
app.use("/api/audit-log", requireAuth, auditLogRoutes);
app.use("/api/jobs", jobRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`HR backend running on http://localhost:${port}`));
