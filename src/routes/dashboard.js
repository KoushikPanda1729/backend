import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/stats", async (req, res) => {
  const [candidateCount, employeeCount, activeEmployees, onboarding, interviewsUpcoming, byStage, pendingLeaveRequests] =
    await Promise.all([
      prisma.candidate.count(),
      prisma.employee.count(),
      prisma.employee.count({ where: { status: "ACTIVE" } }),
      prisma.employee.count({ where: { status: "ONBOARDING" } }),
      prisma.interview.count({ where: { status: "SCHEDULED" } }),
      prisma.candidate.groupBy({ by: ["stage"], _count: true }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    ]);

  res.json({
    candidateCount,
    employeeCount,
    activeEmployees,
    onboarding,
    interviewsUpcoming,
    pendingLeaveRequests,
    byStage: byStage.map((s) => ({ stage: s.stage, count: s._count })),
  });
});

export default router;
