import { prisma } from "./prisma.js";

// Tool schemas the model can call to answer questions with real platform data.
export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_dashboard_summary",
      description: "Overall counts: total employees (by status), total candidates (by hiring stage), and upcoming interview count. Use for broad 'how many' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_employees",
      description: "List employees, optionally filtered by status, department, or name search.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ONBOARDING", "ACTIVE", "INACTIVE", "EXITED"] },
          department: { type: "string" },
          nameContains: { type: "string", description: "Case-insensitive partial name match" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attendance",
      description:
        "Attendance data. Give employeeName to get one employee's present/absent/leave counts for a period. Omit employeeName to get a company-wide breakdown ranked by most leave/absent days — use this for 'who took the most leave' questions. Period defaults to the current month if year/month omitted.",
      parameters: {
        type: "object",
        properties: {
          employeeName: { type: "string", description: "Partial name match; omit for all employees" },
          year: { type: "integer", description: "e.g. 2026" },
          month: { type: "integer", description: "1-12; omit with a year to cover the whole year" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_candidates",
      description: "List hiring-pipeline candidates, optionally filtered by stage or name search.",
      parameters: {
        type: "object",
        properties: {
          stage: {
            type: "string",
            enum: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "ONBOARDING", "HIRED", "REJECTED"],
          },
          nameContains: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_candidate_resume_analysis",
      description: "The AI resume score, strengths, gaps, and recommendation for a specific candidate by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_interviews",
      description: "List scheduled/completed interviews across all candidates, optionally filtered by status or upcoming-only.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["SCHEDULED", "COMPLETED", "CANCELLED"] },
          upcomingOnly: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "Search HR notes (freeform notepad entries and notes linked to a candidate/employee) by text and/or by whose note it is.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for in note content/title" },
          employeeName: { type: "string" },
          candidateName: { type: "string" },
        },
      },
    },
  },
];

function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

async function findEmployeeByName(name) {
  return prisma.employee.findFirst({ where: { name: { contains: name, mode: "insensitive" } } });
}

async function findCandidateByName(name) {
  return prisma.candidate.findFirst({ where: { name: { contains: name, mode: "insensitive" } } });
}

async function toolGetDashboardSummary() {
  const [employeeCount, employeesByStatus, candidateCount, candidatesByStage, upcomingInterviews] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.groupBy({ by: ["status"], _count: true }),
    prisma.candidate.count(),
    prisma.candidate.groupBy({ by: ["stage"], _count: true }),
    prisma.interview.count({ where: { status: "SCHEDULED" } }),
  ]);
  return {
    employeeCount,
    employeesByStatus: employeesByStatus.map((s) => ({ status: s.status, count: s._count })),
    candidateCount,
    candidatesByStage: candidatesByStage.map((s) => ({ stage: s.stage, count: s._count })),
    upcomingInterviews,
  };
}

async function toolListEmployees({ status, department, nameContains }) {
  const employees = await prisma.employee.findMany({
    where: {
      status: status || undefined,
      department: department ? { contains: department, mode: "insensitive" } : undefined,
      name: nameContains ? { contains: nameContains, mode: "insensitive" } : undefined,
    },
    select: {
      id: true,
      employeeCode: true,
      name: true,
      email: true,
      department: true,
      designation: true,
      status: true,
      joinDate: true,
    },
    orderBy: { name: "asc" },
  });
  return { count: employees.length, employees };
}

async function toolGetAttendance({ employeeName, year, month }) {
  const now = new Date();
  const y = year || now.getFullYear();

  if (employeeName) {
    const employee = await findEmployeeByName(employeeName);
    if (!employee) return { error: `No employee found matching "${employeeName}"` };

    const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);
    const counts = {};
    for (const m of months) {
      const { start, end } = monthRange(y, m);
      const records = await prisma.attendance.findMany({
        where: { employeeId: employee.id, date: { gte: start, lt: end } },
      });
      for (const r of records) counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return {
      employee: employee.name,
      period: month ? `${y}-${String(month).padStart(2, "0")}` : `${y} (full year)`,
      counts,
    };
  }

  // Company-wide, ranked by leave+absent days — answers "who took the most leave".
  const employees = await prisma.employee.findMany({ select: { id: true, name: true } });
  const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);
  const results = [];
  for (const emp of employees) {
    const counts = {};
    for (const m of months) {
      const { start, end } = monthRange(y, m);
      const records = await prisma.attendance.findMany({
        where: { employeeId: emp.id, date: { gte: start, lt: end } },
      });
      for (const r of records) counts[r.status] = (counts[r.status] || 0) + 1;
    }
    results.push({
      employee: emp.name,
      counts,
      leaveDays: counts.LEAVE || 0,
      absentDays: counts.ABSENT || 0,
    });
  }
  results.sort((a, b) => b.leaveDays + b.absentDays - (a.leaveDays + a.absentDays));
  return { period: month ? `${y}-${String(month).padStart(2, "0")}` : `${y} (full year)`, rankedByLeaveAndAbsent: results };
}

async function toolListCandidates({ stage, nameContains }) {
  const candidates = await prisma.candidate.findMany({
    where: {
      stage: stage || undefined,
      name: nameContains ? { contains: nameContains, mode: "insensitive" } : undefined,
    },
    include: { resumes: { orderBy: { createdAt: "desc" }, take: 1, select: { score: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return {
    count: candidates.length,
    candidates: candidates.map((c) => ({
      name: c.name,
      roleAppliedFor: c.roleAppliedFor,
      sector: c.sector,
      stage: c.stage,
      latestScore: c.resumes[0]?.score ?? null,
      email: c.email,
      phone: c.phone,
    })),
  };
}

async function toolGetCandidateResumeAnalysis({ name }) {
  const candidate = await findCandidateByName(name);
  if (!candidate) return { error: `No candidate found matching "${name}"` };
  const resume = await prisma.resume.findFirst({
    where: { candidateId: candidate.id },
    orderBy: { createdAt: "desc" },
  });
  if (!resume) return { candidate: candidate.name, error: "No resume uploaded for this candidate yet" };
  return { candidate: candidate.name, score: resume.score, analysis: resume.analysis };
}

async function toolGetInterviews({ status, upcomingOnly }) {
  const interviews = await prisma.interview.findMany({
    where: {
      status: status || undefined,
      scheduledAt: upcomingOnly ? { gte: new Date() } : undefined,
    },
    include: { candidate: { select: { name: true, roleAppliedFor: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return {
    count: interviews.length,
    interviews: interviews.map((iv) => ({
      candidate: iv.candidate.name,
      role: iv.candidate.roleAppliedFor,
      round: iv.round,
      interviewer: iv.interviewer,
      scheduledAt: iv.scheduledAt,
      status: iv.status,
      rating: iv.rating,
      feedback: iv.feedback,
    })),
  };
}

async function toolSearchNotes({ query, employeeName, candidateName }) {
  let employeeId, candidateId;
  if (employeeName) {
    const emp = await findEmployeeByName(employeeName);
    if (!emp) return { error: `No employee found matching "${employeeName}"` };
    employeeId = emp.id;
  }
  if (candidateName) {
    const cand = await findCandidateByName(candidateName);
    if (!cand) return { error: `No candidate found matching "${candidateName}"` };
    candidateId = cand.id;
  }

  const notes = await prisma.note.findMany({
    where: {
      employeeId: employeeId || undefined,
      candidateId: candidateId || undefined,
      OR: query
        ? [
            { content: { contains: query, mode: "insensitive" } },
            { title: { contains: query, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      candidate: { select: { name: true } },
      employee: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return {
    count: notes.length,
    notes: notes.map((n) => ({
      title: n.title,
      content: n.content,
      author: n.author,
      createdAt: n.createdAt,
      linkedTo: n.candidate?.name || n.employee?.name || null,
    })),
  };
}

export async function executeTool(name, args) {
  switch (name) {
    case "get_dashboard_summary":
      return toolGetDashboardSummary();
    case "list_employees":
      return toolListEmployees(args);
    case "get_attendance":
      return toolGetAttendance(args);
    case "list_candidates":
      return toolListCandidates(args);
    case "get_candidate_resume_analysis":
      return toolGetCandidateResumeAnalysis(args);
    case "get_interviews":
      return toolGetInterviews(args);
    case "search_notes":
      return toolSearchNotes(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
