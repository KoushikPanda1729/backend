import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (ext === ".pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === ".txt") {
    return buffer.toString("utf-8");
  }
  throw new Error(`Unsupported resume file type: ${ext}. Use PDF, DOCX or TXT.`);
}
