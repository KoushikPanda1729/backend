import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { openai, CHAT_MODEL } from "../lib/openai.js";

const router = Router();

router.get("/sessions", async (req, res) => {
  const sessions = await prisma.chatSession.findMany({ orderBy: { updatedAt: "desc" } });
  res.json(sessions);
});

router.post("/sessions", async (req, res) => {
  const session = await prisma.chatSession.create({ data: { title: "New chat" } });
  res.status(201).json(session);
});

router.get("/sessions/:id", async (req, res) => {
  const session = await prisma.chatSession.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return res.status(404).json({ error: "Not found" });
  res.json(session);
});

router.patch("/sessions/:id", async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "title required" });
  const session = await prisma.chatSession.update({ where: { id: req.params.id }, data: { title: title.trim() } });
  res.json(session);
});

router.delete("/sessions/:id", async (req, res) => {
  await prisma.chatSession.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Streams the assistant reply back over SSE and persists both sides of the turn.
router.post("/sessions/:id/messages", async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });

  const session = await prisma.chatSession.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });

  await prisma.chatMessage.create({ data: { sessionId: session.id, role: "user", content } });

  if (session.title === "New chat") {
    const shortTitle = content.slice(0, 60);
    await prisma.chatSession.update({ where: { id: session.id }, data: { title: shortTitle } });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const history = [
    {
      role: "system",
      content:
        "You are the built-in HR assistant inside this company's HR platform. Help with anything HR-related: drafting job descriptions, interview questions, offer letters, policy wording, employee communication, resume/candidate advice, and general questions. Be clear and practical for a non-technical HR user.",
    },
    ...session.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content },
  ];

  let fullReply = "";
  try {
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: history,
      stream: true,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        fullReply += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "assistant", content: fullReply },
  });
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

  res.write("data: [DONE]\n\n");
  res.end();
});

export default router;
