import multer from "multer";
import path from "node:path";
import fs from "node:fs";

function makeStorage(subdir) {
  const dir = path.join(process.cwd(), "uploads", subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });
}

export const uploadResume = multer({ storage: makeStorage("resumes") });
export const uploadDocument = multer({ storage: makeStorage("documents") });
