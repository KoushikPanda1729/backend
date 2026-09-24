import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { openai, CHAT_MODEL } from "../lib/openai.js";
import { toolDefinitions, executeTool } from "../lib/aiTools.js";

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
        "You are the built-in HR assistant inside this company's HR platform. Help with anything HR-related: drafting job descriptions, interview questions, offer letters, policy wording, employee communication, resume/candidate advice, and general questions. Be clear and practical for a non-technical HR user. You also have tools to look up real data from this platform — employees, candidates, attendance/leave records, interviews, and notes. Always use a tool instead of guessing when the question is about actual counts, names, scores, or records in this system. When reporting numbers, state them plainly (e.g. '3 employees are on leave today'). Never end your answer with filler like 'let me know if you need anything else' — just stop once the answer is complete.",
    },
    ...session.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content },
  ];

  let fullReply = "";
  try {
    // First pass (non-streaming): let the model decide whether it needs real platform data.
    const first = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: history,
      tools: toolDefinitions,
      tool_choice: "auto",
    });
    const firstMessage = first.choices[0].message;

    if (firstMessage.tool_calls?.length) {
      history.push(firstMessage);
      for (const call of firstMessage.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // malformed args — pass empty object, tool will just use defaults
        }
        const result = await executeTool(call.function.name, args);
        history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }

      // Second pass: stream the final answer synthesized from the tool results.
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
    } else {
      // No tool needed — content is already fully generated, send it in one shot.
      fullReply = firstMessage.content || "";
      res.write(`data: ${JSON.stringify({ token: fullReply })}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "assistant", content: fullReply },
  });
  await prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

  // Quick follow-up suggestions, ChatGPT-style — a small cheap call, sent as its own SSE event.
  if (fullReply) {
    try {
      const suggestionRes = await openai.chat.completions.create({
        model: CHAT_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Based on this HR assistant exchange, suggest exactly 3 short, specific follow-up questions or requests the HR user might want next. Each under 8 words, phrased as something the user would type (not a question about the question). Output ONLY JSON: {\"suggestions\": [\"...\", \"...\", \"...\"]}",
          },
          { role: "user", content: `User asked: ${content}\n\nAssistant answered: ${fullReply.slice(0, 1500)}` },
        ],
      });
      const parsed = JSON.parse(suggestionRes.choices[0].message.content);
      if (Array.isArray(parsed.suggestions)) {
        res.write(`data: ${JSON.stringify({ suggestions: parsed.suggestions.slice(0, 3) })}\n\n`);
      }
    } catch {
      // suggestions are a nice-to-have — never fail the turn over them
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

export default router;
