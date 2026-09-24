import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { uploadResume } from "../lib/upload.js";
import { extractText } from "../lib/extractText.js";
import { analyzeResume } from "../lib/resumeAnalysis.js";

const router = Router();

// List candidates, optionally filtered by stage — powers the pipeline board.
router.get("/", async (req, res) => {
  const { stage } = req.query;
  const candidates = await prisma.candidate.findMany({
    where: stage ? { stage } : undefined,
    include: {
      resumes: { orderBy: { createdAt: "desc" }, take: 1 },
      interviews: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(candidates);
});

router.get("/:id", async (req, res) => {
  const candidate = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    include: {
      resumes: { orderBy: { createdAt: "desc" } },
      interviews: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  res.json(candidate);
});

router.post("/", async (req, res) => {
  const { name, email, phone, roleAppliedFor, sector, source } = req.body;
  if (!name || !roleAppliedFor || !sector) {
    return res.status(400).json({ error: "name, roleAppliedFor and sector are required" });
  }
  const candidate = await prisma.candidate.create({
    data: { name, email, phone, roleAppliedFor, sector, source },
  });
  res.status(201).json(candidate);
});

// Bulk resume upload: HR just drops resumes for a role — each file becomes its own
// candidate automatically. Name/email/phone come from the AI extraction step, no
// manual data entry needed. Files are analyzed in parallel.
router.post("/upload", uploadResume.array("resumes", 25), async (req, res) => {
  const { roleAppliedFor, sector, jobDescription, source } = req.body;
  if (!roleAppliedFor || !sector) {
    return res.status(400).json({ error: "roleAppliedFor and sector are required" });
  }
  if (!req.files?.length) {
    return res.status(400).json({ error: "No resume files uploaded" });
  }

  const results = await Promise.allSettled(
    req.files.map(async (file) => {
      const rawText = await extractText(file.path);
      const analysis = await analyzeResume({ resumeText: rawText, role: roleAppliedFor, sector, jobDescription });
      const profile = analysis.profile || {};

      const candidate = await prisma.candidate.create({
        data: {
          name: profile.name || file.originalname.replace(/\.[^.]+$/, ""),
          email: profile.email || null,
          phone: profile.phone || null,
          roleAppliedFor,
          sector,
          source: source || "Resume upload",
        },
      });

      const resume = await prisma.resume.create({
        data: {
          candidateId: candidate.id,
          fileName: file.originalname,
          filePath: file.path,
          rawText,
          analysis,
          score: analysis.score,
        },
      });

      return { candidate, resume };
    })
  );

  const response = results.map((r, i) => {
    if (r.status === "fulfilled") {
      return { fileName: req.files[i].originalname, ok: true, candidate: r.value.candidate, score: r.value.resume.score };
    }
    console.error(r.reason);
    return { fileName: req.files[i].originalname, ok: false, error: r.reason.message || "Analysis failed" };
  });

  res.status(201).json(response);
});

router.patch("/:id", async (req, res) => {
  const { name, email, phone, roleAppliedFor, sector, source, stage } = req.body;
  const candidate = await prisma.candidate.update({
    where: { id: req.params.id },
    data: { name, email, phone, roleAppliedFor, sector, source, stage },
  });
  res.json(candidate);
});

router.delete("/:id", async (req, res) => {
  await prisma.candidate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Upload + AI-analyze a resume in one step: extract text, run the prompt chain, store the score.
router.post("/:id/resume", uploadResume.single("resume"), async (req, res) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    if (!req.file) return res.status(400).json({ error: "No resume file uploaded" });

    const rawText = await extractText(req.file.path);
    const analysis = await analyzeResume({
      resumeText: rawText,
      role: candidate.roleAppliedFor,
      sector: candidate.sector,
      jobDescription: req.body.jobDescription,
    });

    const resume = await prisma.resume.create({
      data: {
        candidateId: candidate.id,
        fileName: req.file.originalname,
        filePath: req.file.path,
        rawText,
        analysis,
        score: analysis.score,
      },
    });

    res.status(201).json(resume);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Resume analysis failed" });
  }
});

// Interviews
router.post("/:id/interviews", async (req, res) => {
  const { round, interviewer, scheduledAt } = req.body;
  const interview = await prisma.interview.create({
    data: {
      candidateId: req.params.id,
      round,
      interviewer,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    },
  });
  // Only auto-advance the stage if the candidate hasn't already moved further along the pipeline.
  const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (["APPLIED", "SCREENING"].includes(candidate.stage)) {
    await prisma.candidate.update({ where: { id: req.params.id }, data: { stage: "INTERVIEW" } });
  }
  res.status(201).json(interview);
});

router.patch("/interviews/:interviewId", async (req, res) => {
  const { status, feedback, rating, scheduledAt, interviewer, round } = req.body;
  const interview = await prisma.interview.update({
    where: { id: req.params.interviewId },
    data: {
      status,
      feedback,
      rating,
      interviewer,
      round,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    },
  });
  res.json(interview);
});

// Notes on a candidate
router.post("/:id/notes", async (req, res) => {
  const { content, author } = req.body;
  if (!content) return res.status(400).json({ error: "Note content required" });
  const note = await prisma.note.create({
    data: { targetType: "CANDIDATE", candidateId: req.params.id, content, author: author || "HR" },
  });
  res.status(201).json(note);
});

export default router;
