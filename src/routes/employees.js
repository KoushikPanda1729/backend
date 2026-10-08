import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { uploadDocument } from "../lib/upload.js";
import { logAudit, toCsv } from "../lib/audit.js";
import { generateOrgChart } from "../lib/orgChartAI.js";

const router = Router();

router.get("/", async (req, res) => {
  const { status } = req.query;
  const employees = await prisma.employee.findMany({
    where: status ? { status } : undefined,
    include: { documents: true, manager: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json(employees);
});

router.get("/export.csv", async (req, res) => {
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const csv = toCsv(employees, [
    { label: "Employee ID", value: (e) => e.employeeCode },
    { label: "Name", value: (e) => e.name },
    { label: "Email", value: (e) => e.email },
    { label: "Phone", value: (e) => e.phone },
    { label: "Department", value: (e) => e.department },
    { label: "Designation", value: (e) => e.designation },
    { label: "Status", value: (e) => e.status },
    { label: "Join Date", value: (e) => (e.joinDate ? e.joinDate.toISOString().slice(0, 10) : "") },
    { label: "Salary", value: (e) => e.salary },
  ]);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=employees.csv");
  res.send(csv);
});

// Org chart — top-level managers with their reports nested one level (flat list, frontend builds the tree).
router.get("/org-chart", async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { status: { not: "EXITED" } },
    select: { id: true, name: true, designation: true, department: true, managerId: true },
    orderBy: { name: "asc" },
  });
  res.json(employees);
});

// AI-generated hypothetical org/project charts from a text brief — saved so HR can pick from a list later.
router.get("/org-chart/saved", async (req, res) => {
  const snapshots = await prisma.orgChartSnapshot.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(snapshots);
});

router.get("/org-chart/saved/:id", async (req, res) => {
  const snapshot = await prisma.orgChartSnapshot.findUnique({ where: { id: req.params.id } });
  if (!snapshot) return res.status(404).json({ error: "Not found" });
  res.json(snapshot);
});

router.post("/org-chart/generate", async (req, res) => {
  const { name, prompt } = req.body;
  if (!name?.trim() || !prompt?.trim()) return res.status(400).json({ error: "name and prompt are required" });
  try {
    const chart = await generateOrgChart(prompt);
    const snapshot = await prisma.orgChartSnapshot.create({
      data: { name, prompt, nodes: chart.nodes, edges: chart.edges },
    });
    res.status(201).json(snapshot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Generation failed" });
  }
});

router.delete("/org-chart/saved/:id", async (req, res) => {
  await prisma.orgChartSnapshot.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Replace a saved chart's edges — used when HR drags a connection between nodes on the canvas.
router.patch("/org-chart/saved/:id/edges", async (req, res) => {
  const { edges } = req.body;
  if (!Array.isArray(edges)) return res.status(400).json({ error: "edges array is required" });
  const updated = await prisma.orgChartSnapshot.update({ where: { id: req.params.id }, data: { edges } });
  res.json(updated);
});

// Edit a single node's name/title/department/description within a saved chart.
router.patch("/org-chart/saved/:id/nodes/:nodeId", async (req, res) => {
  const { name, title, department, description } = req.body;
  const snapshot = await prisma.orgChartSnapshot.findUnique({ where: { id: req.params.id } });
  if (!snapshot) return res.status(404).json({ error: "Not found" });
  const nodes = snapshot.nodes.map((n) =>
    n.id === req.params.nodeId ? { ...n, name, title, department, description } : n
  );
  const updated = await prisma.orgChartSnapshot.update({ where: { id: req.params.id }, data: { nodes } });
  res.json(updated);
});

// Upcoming birthdays / work anniversaries within the next 30 days — powers the dashboard widget.
router.get("/upcoming-dates", async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { status: { not: "EXITED" } },
    select: { id: true, name: true, dateOfBirth: true, joinDate: true },
  });
  const today = new Date();
  const todayMD = today.getMonth() * 31 + today.getDate();
  function within30(date) {
    if (!date) return null;
    const d = new Date(date);
    let md = d.getMonth() * 31 + d.getDate();
    let diff = md - todayMD;
    if (diff < 0) diff += 372;
    return diff <= 30 ? diff : null;
  }
  const birthdays = employees
    .map((e) => ({ id: e.id, name: e.name, date: e.dateOfBirth, daysAway: within30(e.dateOfBirth) }))
    .filter((e) => e.daysAway != null)
    .sort((a, b) => a.daysAway - b.daysAway);
  const anniversaries = employees
    .map((e) => ({ id: e.id, name: e.name, date: e.joinDate, daysAway: within30(e.joinDate) }))
    .filter((e) => e.daysAway != null)
    .sort((a, b) => a.daysAway - b.daysAway);
  res.json({ birthdays, anniversaries });
});

// Documents expiring within 60 days (or already expired) across all employees.
router.get("/expiring-documents", async (req, res) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 60);
  const documents = await prisma.document.findMany({
    where: { expiryDate: { not: null, lte: cutoff } },
    include: { employee: { select: { id: true, name: true } } },
    orderBy: { expiryDate: "asc" },
  });
  res.json(documents);
});

router.get("/:id", async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: {
      documents: true,
      notes: { orderBy: { createdAt: "desc" } },
      manager: { select: { id: true, name: true } },
      reports: { select: { id: true, name: true, designation: true } },
      payslips: { orderBy: [{ year: "desc" }, { month: "desc" }] },
      performanceReviews: { orderBy: { createdAt: "desc" } },
      offboardingTasks: { orderBy: { createdAt: "asc" } },
      shifts: { orderBy: { date: "asc" } },
    },
  });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

router.post("/", async (req, res) => {
  const { employeeCode, name, email, phone, department, designation, joinDate, dateOfBirth, salary, managerId } = req.body;
  if (!employeeCode || !name) {
    return res.status(400).json({ error: "employeeCode and name are required" });
  }
  const employee = await prisma.employee.create({
    data: {
      employeeCode,
      name,
      email,
      phone,
      department,
      designation,
      joinDate: joinDate ? new Date(joinDate) : null,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      salary: salary || null,
      managerId: managerId || null,
    },
  });
  await logAudit(req, "employee.create", "Employee", employee.id, employee.name);
  res.status(201).json(employee);
});

// Turn a hired candidate directly into an employee record — keeps onboarding to one click.
router.post("/from-candidate/:candidateId", async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const { employeeCode, department, designation, joinDate } = req.body;
  if (!employeeCode) return res.status(400).json({ error: "employeeCode required" });

  const employee = await prisma.employee.create({
    data: {
      employeeCode,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      department,
      designation: designation || candidate.roleAppliedFor,
      joinDate: joinDate ? new Date(joinDate) : new Date(),
      status: "ONBOARDING",
    },
  });
  await prisma.candidate.update({ where: { id: candidate.id }, data: { stage: "HIRED" } });
  await logAudit(req, "employee.hire", "Employee", employee.id, employee.name);
  res.status(201).json(employee);
});

router.patch("/:id", async (req, res) => {
  const { name, email, phone, department, designation, joinDate, dateOfBirth, salary, managerId, status } = req.body;
  const employee = await prisma.employee.update({
    where: { id: req.params.id },
    data: {
      name,
      email,
      phone,
      department,
      designation,
      status,
      joinDate: joinDate ? new Date(joinDate) : undefined,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      salary: salary === "" ? null : salary,
      managerId: managerId === "" ? null : managerId,
    },
  });
  await logAudit(req, "employee.update", "Employee", employee.id, employee.name);
  res.json(employee);
});

router.delete("/:id", async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
  await prisma.employee.delete({ where: { id: req.params.id } });
  await logAudit(req, "employee.delete", "Employee", req.params.id, employee?.name);
  res.status(204).end();
});

// Documents (offer letters, ID proofs, contracts, etc.)
router.post("/:id/documents", uploadDocument.single("document"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const document = await prisma.document.create({
    data: {
      employeeId: req.params.id,
      name: req.body.name || req.file.originalname,
      filePath: req.file.path,
      fileType: req.file.mimetype,
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
    },
  });
  res.status(201).json(document);
});

router.delete("/documents/:docId", async (req, res) => {
  await prisma.document.delete({ where: { id: req.params.docId } });
  res.status(204).end();
});

// Attendance — one record per employee per calendar date.
router.get("/:id/attendance", async (req, res) => {
  const { month } = req.query; // "YYYY-MM", defaults to current month
  const now = new Date();
  const [year, mon] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));

  const records = await prisma.attendance.findMany({
    where: { employeeId: req.params.id, date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
  });
  res.json(records);
});

router.put("/:id/attendance", async (req, res) => {
  const { date, status, note } = req.body;
  if (!date || !status) return res.status(400).json({ error: "date and status are required" });

  const record = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId: req.params.id, date: new Date(date) } },
    update: { status, note },
    create: { employeeId: req.params.id, date: new Date(date), status, note },
  });
  res.json(record);
});

router.delete("/:id/attendance/:date", async (req, res) => {
  await prisma.attendance
    .delete({ where: { employeeId_date: { employeeId: req.params.id, date: new Date(req.params.date) } } })
    .catch(() => {});
  res.status(204).end();
});

// Notes on an employee
router.post("/:id/notes", async (req, res) => {
  const { content, author } = req.body;
  if (!content) return res.status(400).json({ error: "Note content required" });
  const note = await prisma.note.create({
    data: { targetType: "EMPLOYEE", employeeId: req.params.id, content, author: author || "HR" },
  });
  res.status(201).json(note);
});

// Payroll — generate a payslip from the employee's salary for a given month/year.
router.post("/:id/payslips", async (req, res) => {
  const { month, year, deductions } = req.body;
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (!employee.salary) return res.status(400).json({ error: "Set a salary for this employee first" });
  if (!month || !year) return res.status(400).json({ error: "month and year are required" });

  const basic = Number(employee.salary);
  const ded = Number(deductions) || 0;
  const payslip = await prisma.payslip.upsert({
    where: { employeeId_month_year: { employeeId: employee.id, month: Number(month), year: Number(year) } },
    update: { basic, deductions: ded, netPay: basic - ded },
    create: { employeeId: employee.id, month: Number(month), year: Number(year), basic, deductions: ded, netPay: basic - ded },
  });
  await logAudit(req, "payslip.generate", "Payslip", payslip.id, `${employee.name} ${month}/${year}`);
  res.status(201).json(payslip);
});

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

router.get("/payslips/:payslipId/download", async (req, res) => {
  const payslip = await prisma.payslip.findUnique({
    where: { id: req.params.payslipId },
    include: { employee: true },
  });
  if (!payslip) return res.status(404).json({ error: "Not found" });
  const e = payslip.employee;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${MONTH_NAMES[payslip.month]} ${payslip.year}</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;color:#111}
h1{font-size:18px;border-bottom:2px solid #333;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:16px}
td{padding:8px 0;border-bottom:1px solid #eee}
.right{text-align:right}.total{font-weight:bold;border-top:2px solid #333}</style></head>
<body>
<h1>Payslip — ${MONTH_NAMES[payslip.month]} ${payslip.year}</h1>
<p><b>${e.name}</b> (${e.employeeCode})<br>${e.designation || ""} ${e.department ? "· " + e.department : ""}</p>
<table>
<tr><td>Basic Pay</td><td class="right">${Number(payslip.basic).toFixed(2)}</td></tr>
<tr><td>Deductions</td><td class="right">-${Number(payslip.deductions).toFixed(2)}</td></tr>
<tr class="total"><td>Net Pay</td><td class="right">${Number(payslip.netPay).toFixed(2)}</td></tr>
</table>
<p style="margin-top:24px;font-size:12px;color:#777">Generated ${new Date(payslip.generatedAt).toLocaleString()}. Print this page to save as PDF.</p>
</body></html>`;
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Content-Disposition", `attachment; filename=payslip-${e.employeeCode}-${payslip.month}-${payslip.year}.html`);
  res.send(html);
});

// Performance reviews
router.post("/:id/reviews", async (req, res) => {
  const { cycle, rating, goals, feedback, reviewedBy } = req.body;
  if (!cycle) return res.status(400).json({ error: "cycle is required" });
  const review = await prisma.performanceReview.create({
    data: { employeeId: req.params.id, cycle, rating: rating || null, goals, feedback, reviewedBy },
  });
  res.status(201).json(review);
});

router.patch("/reviews/:reviewId", async (req, res) => {
  const { cycle, rating, goals, feedback, reviewedBy } = req.body;
  const review = await prisma.performanceReview.update({
    where: { id: req.params.reviewId },
    data: { cycle, rating, goals, feedback, reviewedBy },
  });
  res.json(review);
});

router.delete("/reviews/:reviewId", async (req, res) => {
  await prisma.performanceReview.delete({ where: { id: req.params.reviewId } });
  res.status(204).end();
});

// Offboarding checklist
const DEFAULT_OFFBOARDING_TASKS = ["Exit interview", "Return company assets", "Revoke system access", "Final settlement"];

router.post("/:id/offboarding/start", async (req, res) => {
  const existing = await prisma.offboardingTask.count({ where: { employeeId: req.params.id } });
  if (existing === 0) {
    await prisma.offboardingTask.createMany({
      data: DEFAULT_OFFBOARDING_TASKS.map((label) => ({ employeeId: req.params.id, label })),
    });
  }
  const tasks = await prisma.offboardingTask.findMany({ where: { employeeId: req.params.id }, orderBy: { createdAt: "asc" } });
  res.status(201).json(tasks);
});

router.post("/:id/offboarding", async (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });
  const task = await prisma.offboardingTask.create({ data: { employeeId: req.params.id, label } });
  res.status(201).json(task);
});

router.patch("/offboarding/:taskId", async (req, res) => {
  const { done } = req.body;
  const task = await prisma.offboardingTask.update({ where: { id: req.params.taskId }, data: { done } });
  res.json(task);
});

router.delete("/offboarding/:taskId", async (req, res) => {
  await prisma.offboardingTask.delete({ where: { id: req.params.taskId } });
  res.status(204).end();
});

// Shift / roster scheduling
router.get("/:id/shifts", async (req, res) => {
  const shifts = await prisma.shift.findMany({ where: { employeeId: req.params.id }, orderBy: { date: "asc" } });
  res.json(shifts);
});

router.put("/:id/shifts", async (req, res) => {
  const { date, startTime, endTime, note } = req.body;
  if (!date || !startTime || !endTime) return res.status(400).json({ error: "date, startTime and endTime are required" });
  const shift = await prisma.shift.upsert({
    where: { employeeId_date: { employeeId: req.params.id, date: new Date(date) } },
    update: { startTime, endTime, note },
    create: { employeeId: req.params.id, date: new Date(date), startTime, endTime, note },
  });
  res.json(shift);
});

router.delete("/:id/shifts/:date", async (req, res) => {
  await prisma.shift
    .delete({ where: { employeeId_date: { employeeId: req.params.id, date: new Date(req.params.date) } } })
    .catch(() => {});
  res.status(204).end();
});

// All shifts across employees for a week/month — powers a roster view.
router.get("/shifts/all", async (req, res) => {
  const { start, end } = req.query;
  const shifts = await prisma.shift.findMany({
    where: start && end ? { date: { gte: new Date(start), lte: new Date(end) } } : undefined,
    include: { employee: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  });
  res.json(shifts);
});

export default router;
