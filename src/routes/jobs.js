import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadResume } from "../lib/upload.js";
import { extractText } from "../lib/extractText.js";
import { analyzeResume } from "../lib/resumeAnalysis.js";

const router = Router();

// Public — careers page listing.
router.get("/", async (req, res) => {
  const jobs = await prisma.jobPosting.findMany({ where: { isOpen: true }, orderBy: { createdAt: "desc" } });
  res.json(jobs);
});

// Public — apply to a posting. Creates a candidate + resume, same AI scoring pipeline as HR uploads.
router.post("/:id/apply", uploadResume.single("resume"), async (req, res) => {
  try {
    const job = await prisma.jobPosting.findUnique({ where: { id: req.params.id } });
    if (!job || !job.isOpen) return res.status(404).json({ error: "This posting is no longer open" });
    if (!req.file) return res.status(400).json({ error: "Resume file required" });

    const { name, email, phone } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const rawText = await extractText(req.file.path);
    const analysis = await analyzeResume({
      resumeText: rawText,
      role: job.title,
      sector: job.sector,
      jobDescription: job.description,
    });

    const candidate = await prisma.candidate.create({
      data: {
        name,
        email: email || analysis.profile?.email || null,
        phone: phone || analysis.profile?.phone || null,
        roleAppliedFor: job.title,
        sector: job.sector,
        source: "Careers page",
      },
    });
    await prisma.resume.create({
      data: { candidateId: candidate.id, fileName: req.file.originalname, filePath: req.file.path, rawText, analysis, score: analysis.score },
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Application failed" });
  }
});

// Admin — manage postings.
router.get("/admin/all", requireAuth, async (req, res) => {
  const jobs = await prisma.jobPosting.findMany({ orderBy: { createdAt: "desc" } });
  res.json(jobs);
});

router.post("/", requireAuth, async (req, res) => {
  const { title, sector, description } = req.body;
  if (!title || !sector || !description) return res.status(400).json({ error: "title, sector and description are required" });
  const job = await prisma.jobPosting.create({ data: { title, sector, description } });
  res.status(201).json(job);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const { title, sector, description, isOpen } = req.body;
  const job = await prisma.jobPosting.update({ where: { id: req.params.id }, data: { title, sector, description, isOpen } });
  res.json(job);
});

router.delete("/:id", requireAuth, async (req, res) => {
  await prisma.jobPosting.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
