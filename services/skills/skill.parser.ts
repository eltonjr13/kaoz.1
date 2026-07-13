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
function parseYamlValue(val: string): any {
  val = val.trim();
  if (!val) return undefined;
  if (val.startsWith("[") || val.startsWith("{")) {
    try {
      return JSON.parse(val);
    } catch (e) {}
  }
  const unquoted = val.replace(/^["']|["']$/g, "").trim();
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  const num = Number(unquoted);
  if (!isNaN(num) && unquoted !== "") return num;
  return unquoted;
}

function parseYamlObject(lines: string[]): any {
  const result: any = {};
  if (lines.length === 0) return result;
  
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  
  if (minIndent === Infinity) return result;
  
  const groups: { key: string; valueLine: string; children: string[] }[] = [];
  let currentGroup: { key: string; valueLine: string; children: string[] } | null = null;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;
    
    if (indent === minIndent) {
      const trimmed = line.trim();
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > -1) {
        const key = trimmed.slice(0, colonIdx).trim().replace(/^-\s*/, "");
        const val = trimmed.slice(colonIdx + 1).trim();
        currentGroup = { key, valueLine: val, children: [] };
        groups.push(currentGroup);
      }
    } else {
      if (currentGroup) {
        currentGroup.children.push(line);
      }
    }
  }
  
  for (const group of groups) {
    if (group.children.length > 0) {
      result[group.key] = parseYamlObject(group.children);
    } else {
      result[group.key] = parseYamlValue(group.valueLine);
    }
  }
  
  return result;
}

function parseYamlTools(lines: string[]): any[] {
  const tools: any[] = [];
  let currentTool: any = null;
  let inInputSchema = false;
  let schemaLines: string[] = [];
  let schemaIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matchIndent = line.match(/^(\s*)/);
    const indent = matchIndent ? matchIndent[1].length : 0;

    if (inInputSchema) {
      if (indent > schemaIndent) {
        schemaLines.push(line);
        continue;
      } else {
        if (currentTool) {
          currentTool.inputSchema = parseYamlObject(schemaLines);
        }
        inInputSchema = false;
        schemaLines = [];
      }
    }

    const dashMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (dashMatch) {
      if (currentTool) {
        tools.push(currentTool);
      }
      currentTool = {};
      const rest = dashMatch[2].trim();
      if (rest) {
        const colonIdx = rest.indexOf(":");
        if (colonIdx > -1) {
          const k = rest.slice(0, colonIdx).trim();
          const v = rest.slice(colonIdx + 1).trim();
          currentTool[k] = parseYamlValue(v);
        }
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      if (key === "inputSchema") {
        inInputSchema = true;
        schemaIndent = indent;
        schemaLines = [];
        if (val) {
          if (val.startsWith("{") || val.startsWith("[")) {
            try {
              currentTool.inputSchema = JSON.parse(val);
              inInputSchema = false;
            } catch (e) {}
          } else {
            schemaLines.push(line);
          }
        }
      } else if (currentTool) {
        currentTool[key] = parseYamlValue(val);
      }
    }
  }

  if (inInputSchema && currentTool) {
    currentTool.inputSchema = parseYamlObject(schemaLines);
  }
  if (currentTool) {
    tools.push(currentTool);
  }

  return tools;
}

export function parseSkillMarkdown(id: string, content: string): KaozSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  
  if (!match) {
    throw new Error(`Formato inválido no SKILL.md da skill ${id}`);
  }

  const frontmatterStr = match[1];
  const instructions = match[2].trim();
  
  const skill: Partial<KaozSkill> = { id, instructions, preferredTools: [], requiredCapabilities: [], tools: [] };
  
  const lines = frontmatterStr.split(/\r?\n/);
  const sections: { key: string; contentLines: string[] }[] = [];
  let currentSection: { key: string; contentLines: string[] } | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const matchKey = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (matchKey) {
      currentSection = { key: matchKey[1], contentLines: [matchKey[2]] };
      sections.push(currentSection);
    } else {
      if (currentSection) {
        currentSection.contentLines.push(line);
      }
    }
  }

  for (const sec of sections) {
    const key = sec.key;
    const value = sec.contentLines.join("\n").trim();
    if (key === "name") skill.name = value.replace(/^"|"$/g, '').trim();
    else if (key === "description") skill.description = value.replace(/^"|"$/g, '').trim();
    else if (key === "version") skill.version = value.replace(/^"|"$/g, '').trim();
    else if (key === "approvalMode") skill.approvalMode = value.replace(/^"|"$/g, '').trim() as any;
    else if (key === "enabled") {
      const cleanVal = value.replace(/^"|"$/g, '').trim();
      skill.enabled = cleanVal === "true";
    }
    else if (key === "preferredTools") {
      if (value.startsWith("[")) {
        try {
          skill.preferredTools = JSON.parse(value);
        } catch (e) {
          console.warn(`Erro ao parsear preferredTools na skill ${id}`);
        }
      } else {
        const list: string[] = [];
        for (const line of sec.contentLines) {
          const trimmed = line.trim();
          const matchItem = trimmed.match(/^-\s*(.*)$/);
          if (matchItem) {
            list.push(matchItem[1].replace(/^"|"$/g, '').trim());
          }
        }
        skill.preferredTools = list;
      }
    }
    else if (key === "requiredCapabilities") {
      if (value.startsWith("[")) {
        try {
          skill.requiredCapabilities = JSON.parse(value);
        } catch (e) {
          console.warn(`Erro ao parsear requiredCapabilities na skill ${id}`);
        }
      } else {
        const list: string[] = [];
        for (const line of sec.contentLines) {
          const trimmed = line.trim();
          const matchItem = trimmed.match(/^-\s*(.*)$/);
          if (matchItem) {
            list.push(matchItem[1].replace(/^"|"$/g, '').trim());
          }
        }
        skill.requiredCapabilities = list;
      }
    }
    else if (key === "tools") {
      let toolsList: any[] = [];
      if (value.startsWith("[")) {
        try {
          toolsList = JSON.parse(value);
        } catch (e) {
          console.warn(`Erro ao parsear tools JSON na skill ${id}`);
        }
      } else {
        toolsList = parseYamlTools(sec.contentLines);
      }
      for (const t of toolsList) {
        if (t.script && !t.script.startsWith("skills/")) {
          t.script = `skills/${id}/${t.script}`;
        }
      }
      skill.tools = toolsList;
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
