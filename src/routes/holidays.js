import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (req, res) => {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  res.json(holidays);
});

// Add a holiday and auto-mark every active employee's attendance as HOLIDAY for that date.
router.post("/", async (req, res) => {
  const { name, date } = req.body;
  if (!name || !date) return res.status(400).json({ error: "name and date are required" });

  const holiday = await prisma.holiday.create({ data: { name, date: new Date(date) } });

  const employees = await prisma.employee.findMany({ where: { status: { not: "EXITED" } }, select: { id: true } });
  await Promise.all(
    employees.map((e) =>
      prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: e.id, date: new Date(date) } },
        update: { status: "HOLIDAY", note: name },
        create: { employeeId: e.id, date: new Date(date), status: "HOLIDAY", note: name },
      })
    )
  );

  res.status(201).json(holiday);
});

router.delete("/:id", async (req, res) => {
  await prisma.holiday.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
