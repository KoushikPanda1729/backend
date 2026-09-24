import { openai, CHAT_MODEL } from "./openai.js";

async function askJson(system, user) {
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

// Step 1: pull structured facts out of raw resume text (works for any role/sector/industry).
async function extractProfile(resumeText) {
  return askJson(
    `You extract structured candidate profile data from a resume. Output ONLY JSON with keys:
name, email, phone, totalExperienceYears (number, best estimate), skills (string array),
education (array of {degree, institution, year}), workHistory (array of {company, title, durationYears, highlights (string array)}),
certifications (string array), summary (2-3 sentence neutral summary of the candidate).
If a field is unknown, use null or an empty array. Never invent facts not implied by the text.`,
    `Resume text:\n"""${resumeText.slice(0, 12000)}"""`
  );
}

// Step 2: score the extracted profile against the specific role + sector the HR user is hiring for.
async function scoreAgainstRole(profile, role, sector, jobDescription) {
  return askJson(
    `You are an expert recruiter scoring a candidate profile against a target job.
Score fairly and consistently for ANY role or sector (tech, sales, teaching/education, healthcare, finance, manufacturing, retail, etc).
Output ONLY JSON with keys:
overallScore (0-100 integer, overall fit for this exact role/sector),
skillsMatchScore (0-100), experienceMatchScore (0-100), educationMatchScore (0-100),
strengths (string array, 3-6 items), gaps (string array, 3-6 items),
recommendation (one of: "Strongly Recommend", "Recommend", "Consider", "Not a Fit"),
recommendationReason (2-3 sentences, plain language a non-technical HR person can understand),
suggestedInterviewQuestions (string array, 3-5 role-specific questions to verify weak/strong areas).`,
    `Target role: ${role}\nTarget sector/industry: ${sector}\nJob description / requirements (may be empty): ${jobDescription || "N/A"}\n\nCandidate profile JSON:\n${JSON.stringify(profile)}`
  );
}

// Prompt-chained resume analysis: extract -> score. Returns a single merged result to store/display.
export async function analyzeResume({ resumeText, role, sector, jobDescription }) {
  const profile = await extractProfile(resumeText);
  const scoring = await scoreAgainstRole(profile, role, sector, jobDescription);
  return {
    profile,
    scoring,
    score: scoring.overallScore ?? null,
    analyzedAt: new Date().toISOString(),
    role,
    sector,
  };
}
