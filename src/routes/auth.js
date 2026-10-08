import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!user) return res.status(401).json({ error: "Wrong username or password" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Wrong username or password" });

  const token = jwt.sign({ sub: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { username: user.username, name: user.name } });
});

export default router;
