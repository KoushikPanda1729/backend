import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

// Freeform notepad — general notes not attached to any candidate or employee.
router.get("/general", async (req, res) => {
  const notes = await prisma.note.findMany({
    where: { targetType: "GENERAL" },
    orderBy: { updatedAt: "desc" },
  });
  res.json(notes);
});

router.post("/general", async (req, res) => {
  const note = await prisma.note.create({
    data: { targetType: "GENERAL", title: req.body.title || "New Note", content: req.body.content || "" },
  });
  res.status(201).json(note);
});

router.patch("/general/:id", async (req, res) => {
  const { title, content } = req.body;
  const note = await prisma.note.update({
    where: { id: req.params.id },
    data: { title, content },
  });
  res.json(note);
});

// Combined HR notes feed across all candidates and employees, newest first.
router.get("/", async (req, res) => {
  const notes = await prisma.note.findMany({
    where: { targetType: { in: ["CANDIDATE", "EMPLOYEE"] } },
    include: {
      candidate: { select: { id: true, name: true } },
      employee: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(notes);
});

router.delete("/:id", async (req, res) => {
  await prisma.note.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
