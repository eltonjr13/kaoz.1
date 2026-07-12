import type { KaozSkill, SkillToolDefinition } from "./skill.types";

/**
 * Faz o parse simples de um arquivo SKILL.md.
 * O formato esperado é:
 * ---
 * name: skill-name
 * description: ...
 * version: 1.0.0
 * preferredTools: ["tool1", "tool2"]
 * requiredCapabilities: ["cap1"]
 * approvalMode: plan
 * enabled: true
 * tools: [{"id":"skill:name:tool", "description":"...", "script":"script.js", "inputSchema":{}}]
 * ---
 * # Conteúdo Markdown (Instruções)
 */
export function parseSkillMarkdown(id: string, content: string): KaozSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  
  if (!match) {
    throw new Error(`Formato inválido no SKILL.md da skill ${id}`);
  }

  const frontmatterStr = match[1];
  const instructions = match[2].trim();
  
  const skill: Partial<KaozSkill> = { id, instructions, preferredTools: [], requiredCapabilities: [], tools: [] };
  
  const lines = frontmatterStr.split(/\r?\n/);
  let currentKey = "";
  let jsonBuffer = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Continue reading JSON buffer if we are inside one
    if (jsonBuffer) {
        jsonBuffer += line;
        if (jsonBuffer.endsWith("]") || jsonBuffer.endsWith("}")) {
            try {
                if (currentKey === "preferredTools") skill.preferredTools = JSON.parse(jsonBuffer);
                else if (currentKey === "requiredCapabilities") skill.requiredCapabilities = JSON.parse(jsonBuffer);
                else if (currentKey === "tools") skill.tools = JSON.parse(jsonBuffer);
            } catch (e) {
                console.warn(`Erro ao parsear JSON no frontmatter da skill ${id} na chave ${currentKey}`);
            }
            jsonBuffer = "";
            currentKey = "";
        }
        continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx > -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      
      if (value.startsWith("[") || value.startsWith("{")) {
          if (value.endsWith("]") || value.endsWith("}")) {
             try {
                if (key === "preferredTools") skill.preferredTools = JSON.parse(value);
                else if (key === "requiredCapabilities") skill.requiredCapabilities = JSON.parse(value);
                else if (key === "tools") skill.tools = JSON.parse(value);
             } catch(e) {
                 console.warn(`Erro ao parsear JSON no frontmatter da skill ${id} na chave ${key}`);
             }
          } else {
             currentKey = key;
             jsonBuffer = value;
          }
      } else {
          if (key === "name") skill.name = value.replace(/^"|"$/g, '');
          if (key === "description") skill.description = value.replace(/^"|"$/g, '');
          if (key === "version") skill.version = value.replace(/^"|"$/g, '');
          if (key === "approvalMode") skill.approvalMode = value as any;
          if (key === "enabled") skill.enabled = value === "true";
      }
    }
  }

  return {
    id: skill.id || id,
    name: skill.name || id,
    description: skill.description || "",
    version: skill.version || "1.0.0",
    instructions: skill.instructions || "",
    preferredTools: skill.preferredTools || [],
    requiredCapabilities: skill.requiredCapabilities || [],
    approvalMode: skill.approvalMode || "plan",
    enabled: skill.enabled !== false,
    tools: skill.tools || []
  };
}
