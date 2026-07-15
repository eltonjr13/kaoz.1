import type { KaozSkill, SkillToolDefinition } from "./skill.types";
import type { ApprovalMode, ToolEffect } from "../orchestrator/orchestrator.types";
import { normalizeScriptPolicy } from "./skill.policy";

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
function parseYamlValue(val: string): unknown {
  val = val.trim();
  if (!val) return undefined;
  if (val.startsWith("[") || val.startsWith("{")) {
    try {
      return JSON.parse(val);
    } catch {
      // no-op
    }
  }
  const unquoted = val.replace(/^["']|["']$/g, "").trim();
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  const num = Number(unquoted);
  if (!isNaN(num) && unquoted !== "") return num;
  return unquoted;
}

function getMinIndent(lines: string[]): number {
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  return minIndent;
}

interface YamlGroup {
  key: string;
  valueLine: string;
  children: string[];
}

function buildYamlGroups(lines: string[], minIndent: number): YamlGroup[] {
  const groups: YamlGroup[] = [];
  let currentGroup: YamlGroup | null = null;
  
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
    } else if (currentGroup) {
      currentGroup.children.push(line);
    }
  }
  return groups;
}

function parseYamlObject(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (lines.length === 0) return result;
  
  const minIndent = getMinIndent(lines);
  if (minIndent === Infinity) return result;
  
  const groups = buildYamlGroups(lines, minIndent);
  
  for (const group of groups) {
    if (group.children.length > 0) {
      result[group.key] = parseYamlObject(group.children);
    } else {
      result[group.key] = parseYamlValue(group.valueLine);
    }
  }
  
  return result;
}

function handleInputSchemaLine(
  line: string,
  indent: number,
  schemaIndent: number,
  schemaLines: string[],
  currentTool: Record<string, unknown> | null
): { inInputSchema: boolean; schemaLines: string[] } {
  if (indent > schemaIndent) {
    schemaLines.push(line);
    return { inInputSchema: true, schemaLines };
  } else {
    if (currentTool) {
      currentTool.inputSchema = parseYamlObject(schemaLines);
    }
    return { inInputSchema: false, schemaLines: [] };
  }
}

function handleDashMatch(
  dashMatch: RegExpMatchArray,
  tools: Record<string, unknown>[],
  currentTool: Record<string, unknown> | null
): Record<string, unknown> {
  if (currentTool) {
    tools.push(currentTool);
  }
  const newTool: Record<string, unknown> = {};
  const rest = dashMatch[2].trim();
  if (rest) {
    const colonIdx = rest.indexOf(":");
    if (colonIdx > -1) {
      const k = rest.slice(0, colonIdx).trim();
      const v = rest.slice(colonIdx + 1).trim();
      newTool[k] = parseYamlValue(v);
    }
  }
  return newTool;
}

function handleColonMatch(
  line: string,
  trimmed: string,
  colonIdx: number,
  indent: number,
  currentTool: Record<string, unknown> | null
): { inInputSchema: boolean; schemaIndent: number; schemaLines: string[] } {
  const key = trimmed.slice(0, colonIdx).trim();
  const val = trimmed.slice(colonIdx + 1).trim();
  let inInputSchema = false;
  let schemaIndent = 0;
  const schemaLines: string[] = [];

  if (key === "inputSchema") {
    inInputSchema = true;
    schemaIndent = indent;
    if (val) {
      if (val.startsWith("{") || val.startsWith("[")) {
        try {
          if (currentTool) {
            currentTool.inputSchema = JSON.parse(val);
          }
          inInputSchema = false;
        } catch {
          // no-op
        }
      } else {
        schemaLines.push(line);
      }
    }
  } else if (currentTool) {
    currentTool[key] = parseYamlValue(val);
  }
  return { inInputSchema, schemaIndent, schemaLines };
}

interface YamlToolsState {
  tools: Record<string, unknown>[];
  currentTool: Record<string, unknown> | null;
  inInputSchema: boolean;
  schemaLines: string[];
  schemaIndent: number;
}

function processToolsLine(line: string, state: YamlToolsState): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  const matchIndent = line.match(/^(\s*)/);
  const indent = matchIndent ? matchIndent[1].length : 0;

  if (state.inInputSchema) {
    const res = handleInputSchemaLine(line, indent, state.schemaIndent, state.schemaLines, state.currentTool);
    state.inInputSchema = res.inInputSchema;
    state.schemaLines = res.schemaLines;
    if (state.inInputSchema) return;
  }

  const dashMatch = line.match(/^(\s*)-\s*(.*)$/);
  if (dashMatch) {
    state.currentTool = handleDashMatch(dashMatch, state.tools, state.currentTool);
    return;
  }

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > -1) {
    const res = handleColonMatch(line, trimmed, colonIdx, indent, state.currentTool);
    if (res.inInputSchema) {
      state.inInputSchema = true;
      state.schemaIndent = res.schemaIndent;
      state.schemaLines = res.schemaLines;
    }
  }
}

function parseYamlTools(lines: string[]): Record<string, unknown>[] {
  const state: YamlToolsState = {
    tools: [],
    currentTool: null,
    inInputSchema: false,
    schemaLines: [],
    schemaIndent: 0,
  };

  for (const line of lines) {
    processToolsLine(line, state);
  }

  if (state.inInputSchema && state.currentTool) {
    state.currentTool.inputSchema = parseYamlObject(state.schemaLines);
  }
  if (state.currentTool) {
    state.tools.push(state.currentTool);
  }

  return state.tools;
}

function parseListOrJson(value: string, contentLines: string[], errMsg: string): string[] {
  if (value.startsWith("[")) {
    try {
      return JSON.parse(value) as string[];
    } catch {
      console.warn(`Erro ao parsear ${errMsg}`);
      return [];
    }
  }
  const list: string[] = [];
  for (const line of contentLines) {
    const trimmed = line.trim();
    const matchItem = trimmed.match(/^-\s*(.*)$/);
    if (matchItem) {
      list.push(matchItem[1].replace(/^"|"$/g, '').trim());
    }
  }
  return list;
}

function parseToolInputSchema(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { type: "object" };
}

function parseToolsSection(value: string, contentLines: string[], id: string): SkillToolDefinition[] {
  let toolsList: Record<string, unknown>[] = [];
  if (value.startsWith("[")) {
    try {
      toolsList = JSON.parse(value) as Record<string, unknown>[];
    } catch {
      console.warn(`Erro ao parsear tools JSON na skill ${id}`);
    }
  } else {
    toolsList = parseYamlTools(contentLines);
  }
  const typedTools: SkillToolDefinition[] = [];
  for (const t of toolsList) {
    if (t.script && typeof t.script === "string" && !t.script.startsWith("skills/")) {
      t.script = `skills/${id}/${t.script}`;
    }
    const toolDef: SkillToolDefinition = {
      id: String(t.id || ""),
      description: String(t.description || ""),
      script: String(t.script || ""),
      inputSchema: parseToolInputSchema(t.inputSchema),
      effect: ["read", "write", "external", "destructive"].includes(String(t.effect)) ? t.effect as ToolEffect : "write",
      approvalMode: ["never", "plan", "step"].includes(String(t.approvalMode)) ? t.approvalMode as ApprovalMode : "plan",
      policy: normalizeScriptPolicy(t.policy && typeof t.policy === "object" ? t.policy : undefined),
    };
    typedTools.push(toolDef);
  }
  return typedTools;
}

function parseBasicKeys(key: string, cleanVal: string, skill: Partial<KaozSkill>): boolean {
  if (key === "name") skill.name = cleanVal;
  else if (key === "description") skill.description = cleanVal;
  else if (key === "version") skill.version = cleanVal;
  else return false;
  return true;
}

function parseApprovalMode(cleanVal: string, skill: Partial<KaozSkill>): void {
  if (cleanVal === "plan" || cleanVal === "step" || cleanVal === "never") {
    skill.approvalMode = cleanVal;
  }
}

function parseSectionKey(
  key: string,
  value: string,
  contentLines: string[],
  id: string,
  skill: Partial<KaozSkill>
): void {
  const cleanVal = value.replace(/^"|"$/g, '').trim();
  if (parseBasicKeys(key, cleanVal, skill)) return;

  if (key === "approvalMode") {
    parseApprovalMode(cleanVal, skill);
  } else if (key === "enabled") {
    skill.enabled = cleanVal === "true";
  } else if (key === "preferredTools") {
    skill.preferredTools = parseListOrJson(value, contentLines, `preferredTools na skill ${id}`);
  } else if (key === "requiredCapabilities") {
    skill.requiredCapabilities = parseListOrJson(value, contentLines, `requiredCapabilities na skill ${id}`);
  } else if (key === "tools") {
    skill.tools = parseToolsSection(value, contentLines, id);
  }
}

interface FrontmatterSection {
  key: string;
  contentLines: string[];
}

function parseSections(frontmatterStr: string): FrontmatterSection[] {
  const lines = frontmatterStr.split(/\r?\n/);
  const sections: FrontmatterSection[] = [];
  let currentSection: FrontmatterSection | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const matchKey = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (matchKey) {
      currentSection = { key: matchKey[1], contentLines: [matchKey[2]] };
      sections.push(currentSection);
    } else if (currentSection) {
      currentSection.contentLines.push(line);
    }
  }
  return sections;
}

function buildKaozSkill(skill: Partial<KaozSkill>, id: string, instructions: string): KaozSkill {
  return {
    id: skill.id || id,
    name: skill.name || id,
    description: skill.description || "",
    version: skill.version || "1.0.0",
    instructions,
    preferredTools: skill.preferredTools || [],
    requiredCapabilities: skill.requiredCapabilities || [],
    approvalMode: skill.approvalMode || "plan",
    enabled: skill.enabled !== false,
    tools: skill.tools || []
  };
}

export function parseSkillMarkdown(id: string, content: string): KaozSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  
  if (!match) {
    throw new Error(`Formato inválido no SKILL.md da skill ${id}`);
  }

  const frontmatterStr = match[1];
  const instructions = match[2].trim();
  
  const skill: Partial<KaozSkill> = { id, instructions, preferredTools: [], requiredCapabilities: [], tools: [] };
  const sections = parseSections(frontmatterStr);

  for (const sec of sections) {
    const key = sec.key;
    const value = sec.contentLines.join("\n").trim();
    parseSectionKey(key, value, sec.contentLines, id, skill);
  }

  return buildKaozSkill(skill, id, instructions);
}
