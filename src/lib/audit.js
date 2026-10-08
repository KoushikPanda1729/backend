import { prisma } from "./prisma.js";

export async function logAudit(req, action, entityType, entityId, detail) {
  await prisma.auditLog.create({
    data: {
      actor: req.user?.username || "system",
      action,
      entityType,
      entityId: entityId || null,
      detail: detail || null,
    },
  }).catch((err) => console.error("audit log failed", err));
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => c.label).join(",");
  const lines = rows.map((row) => columns.map((c) => esc(c.value(row))).join(","));
  return [header, ...lines].join("\n");
}
