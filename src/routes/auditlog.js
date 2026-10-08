import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  res.json(logs);
});

export default router;
