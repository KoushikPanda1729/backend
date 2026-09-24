import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/resume/:id", async (req, res) => {
  const resume = await prisma.resume.findUnique({ where: { id: req.params.id } });
  if (!resume) return res.status(404).json({ error: "Not found" });
  res.download(resume.filePath, resume.fileName);
});

router.get("/document/:id", async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.download(doc.filePath, doc.name);
});

export default router;
