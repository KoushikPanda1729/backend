import { Router } from "express";
import { google } from "googleapis";
import { requireAuth } from "../middleware/auth.js";
import {
  getAuthUrl,
  saveTokensFromCode,
  listAccounts,
  disconnectAccount,
  getAuthorizedClient,
} from "../lib/googleClient.js";

const router = Router();

// Not behind requireAuth — Google redirects the browser here directly, no way to attach our Bearer token.
router.get("/connect", (req, res) => {
  res.redirect(getAuthUrl());
});

router.get("/callback", async (req, res) => {
  const { code, error } = req.query;
  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
  if (error || !code) {
    return res.redirect(`${frontend}/sheets?google_error=${encodeURIComponent(error || "missing_code")}`);
  }
  try {
    await saveTokensFromCode(code);
    res.redirect(`${frontend}/sheets?google_connected=1`);
  } catch (err) {
    console.error(err);
    res.redirect(`${frontend}/sheets?google_error=${encodeURIComponent(err.message)}`);
  }
});

router.get("/accounts", requireAuth, async (req, res) => {
  res.json(await listAccounts());
});

router.delete("/accounts/:id", requireAuth, async (req, res) => {
  await disconnectAccount(req.params.id);
  res.status(204).end();
});

// Real spreadsheets from one connected account's Drive — no separate API key needed, just its OAuth token.
router.get("/accounts/:id/spreadsheets", requireAuth, async (req, res) => {
  try {
    const auth = await getAuthorizedClient(req.params.id);
    const drive = google.drive({ version: "v3", auth });
    const { data } = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "files(id,name,webViewLink,modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 50,
    });
    res.json(data.files.map((f) => ({ id: f.id, name: f.name, url: f.webViewLink, modifiedTime: f.modifiedTime })));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/accounts/:id/create-sheet", requireAuth, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const auth = await getAuthorizedClient(req.params.id);
    const sheets = google.sheets({ version: "v4", auth });
    const { data } = await sheets.spreadsheets.create({ requestBody: { properties: { title } } });
    res.status(201).json({ id: data.spreadsheetId, url: data.spreadsheetUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
