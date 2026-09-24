import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { uploadDocument } from "../lib/upload.js";

const router = Router();

router.get("/", async (req, res) => {
  const { status } = req.query;
  const employees = await prisma.employee.findMany({
    where: status ? { status } : undefined,
    include: { documents: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json(employees);
});

router.get("/:id", async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: { documents: true, notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

router.post("/", async (req, res) => {
  const { employeeCode, name, email, phone, department, designation, joinDate } = req.body;
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
    },
  });
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
  res.status(201).json(employee);
});

router.patch("/:id", async (req, res) => {
  const { name, email, phone, department, designation, joinDate, status } = req.body;
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
    },
  });
  res.json(employee);
});

router.delete("/:id", async (req, res) => {
  await prisma.employee.delete({ where: { id: req.params.id } });
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

export default router;
