import { openai, CHAT_MODEL } from "./openai.js";

export async function generateOrgChart(prompt) {
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: `You design org charts / project team structures from a plain-language brief.
Output ONLY JSON with shape:
{"nodes": [{"id": "n1", "name": "...", "title": "...", "department": "...", "description": "..."}], "edges": [{"from": "n1", "to": "n2"}]}
Rules:
- "name" is a role or person name as implied by the brief (e.g. "Project Lead", "Backend Team" or a real name if given).
- "title" is their designation/role, "department" is their team/function (can be empty string).
- "description" is one short sentence (max ~12 words) on what this role/node owns or does.
- Every edge "from" must be the manager/parent node id, "to" the report/child node id — this forms a tree (one root with no incoming edge).
- Keep it to 5-25 nodes unless the brief clearly needs more.
- Infer a sensible hierarchy even if the brief is vague.`,
      },
      { role: "user", content: prompt.slice(0, 4000) },
    ],
  });
  const result = JSON.parse(completion.choices[0].message.content);
  return { nodes: result.nodes || [], edges: result.edges || [] };
}
