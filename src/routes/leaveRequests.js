import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function dateRange(startDate, endDate) {
  const dates = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Public — no requireAuth. An employee reaches this via their own per-employee link, no login exists for them.
router.get("/public/:employeeId", async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.employeeId },
    select: { id: true, name: true, employeeCode: true, designation: true },
  });
  if (!employee) return res.status(404).json({ error: "Employee link not found" });

  const requests = await prisma.leaveRequest.findMany({
    where: { employeeId: employee.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ employee, requests });
});

router.post("/public/:employeeId", async (req, res) => {
  const { startDate, endDate, reason } = req.body;
  if (!startDate || !endDate || !reason) {
    return res.status(400).json({ error: "startDate, endDate and reason are required" });
  }
  const employee = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
  if (!employee) return res.status(404).json({ error: "Employee link not found" });
  if (new Date(endDate) < new Date(startDate)) {
    return res.status(400).json({ error: "End date must be on or after the start date" });
  }

  const request = await prisma.leaveRequest.create({
    data: { employeeId: employee.id, startDate: new Date(startDate), endDate: new Date(endDate), reason },
  });
  res.status(201).json(request);
});

// HR side — behind requireAuth.
router.get("/", requireAuth, async (req, res) => {
  const { status } = req.query;
  const requests = await prisma.leaveRequest.findMany({
    where: status ? { status } : undefined,
    include: { employee: { select: { id: true, name: true, employeeCode: true, designation: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(requests);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const { status, reviewNote } = req.body;
  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ error: "status must be APPROVED or REJECTED" });
  }

  const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const request = await prisma.leaveRequest.update({
    where: { id: req.params.id },
    data: { status, reviewNote },
  });

  // Approving marks each day of the range as LEAVE in attendance, reusing the same upsert-by-day pattern.
  if (status === "APPROVED") {
    const days = dateRange(existing.startDate, existing.endDate);
    await Promise.all(
      days.map((date) =>
        prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: existing.employeeId, date } },
          update: { status: "LEAVE", note: `Approved leave request: ${existing.reason}` },
          create: { employeeId: existing.employeeId, date, status: "LEAVE", note: `Approved leave request: ${existing.reason}` },
        })
      )
    );
  }

  res.json(request);
});

export default router;
