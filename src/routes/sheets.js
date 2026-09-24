import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

function extractFileId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

router.get("/", async (req, res) => {
  const sheets = await prisma.sheetEmbed.findMany({ orderBy: { updatedAt: "desc" } });
  res.json(sheets);
});

router.post("/", async (req, res) => {
  const { title, url } = req.body;
  if (!title || !url) return res.status(400).json({ error: "title and url are required" });
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) {
    return res.status(400).json({ error: "url must be a Google Sheets link" });
  }

  const fileId = extractFileId(url);
  if (fileId) {
    const existing = await prisma.sheetEmbed.findUnique({ where: { fileId } });
    if (existing) return res.status(200).json(existing);
  }

  const sheet = await prisma.sheetEmbed.create({ data: { title, url, fileId } });
  res.status(201).json(sheet);
});

router.patch("/:id", async (req, res) => {
  const { title, url } = req.body;
  const sheet = await prisma.sheetEmbed.update({
    where: { id: req.params.id },
    data: { title, url },
  });
  res.json(sheet);
});

router.delete("/:id", async (req, res) => {
  await prisma.sheetEmbed.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
