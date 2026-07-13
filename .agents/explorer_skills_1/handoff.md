# Handoff Report - Skills Investigation

## 1. Observation
We observed the following files and code snippets in the repository:
1. In `services/skills/skill.parser.ts`:
   - Line 78 checks if a skill is enabled: `if (key === "enabled") skill.enabled = value === "true";`
   - Line 55 checks if frontmatter lines contain a colon: `const colonIdx = line.indexOf(":"); const key = line.slice(0, colonIdx).trim(); const value = line.slice(colonIdx + 1).trim();`
2. In `skills/trend-hunter/SKILL.md`:
   - Line 8 defines: `enabled: "true"`
   - Lines 9-16 define `tools` in YAML format:
     ```yaml
     tools:
       - id: "skill:trend-hunter:search"
         description: "Busca tópicos virais e vídeos populares de um determinado nicho."
         script: "scripts/search-viral.ts"
         inputSchema:
           type: "object"
           required: ["niche"]
     ```
3. In `services/skills/skill.registry.ts`:
   - Lines 96-107 construct the frontmatter for saving a skill without including the `tools` field:
     ```typescript
     const content = `---
     name: ${JSON.stringify(skill.name)}
     ...
     enabled: ${skill.enabled}
     ---
     ${skill.instructions}
     `;
     ```
4. In `components/settings/SkillsSettingsPanel.tsx`:
   - The UI fetches all skills via `GET /api/skills?full=true` which links to `skillRegistry.getAll()`.
   - The UI edit form has input fields only for ID, name, description, and Markdown instructions, missing any field to list, show, or edit custom scripts/tools.

We ran a simulation in `test-parser.ts` where we parsed `trend-hunter/SKILL.md` using the exact parser implementation and got:
```json
{
  "id": "trend-hunter",
  "name": "trend-hunter",
  "description": "Busca tópicos virais e vídeos populares de um determinado nicho.",
  "version": "1.0.0",
  "instructions": "...",
  "preferredTools": [],
  "requiredCapabilities": [],
  "approvalMode": "\"plan\"",
  "enabled": false,
  "tools": []
}
```

---

## 2. Logic Chain
1. From Observation 1 and 2, because the frontmatter uses quoted strings (`enabled: "true"`), the extracted `value` variable in the parser contains the outer quotes (`'"true"'`). Therefore, `value === "true"` evaluates to false, resulting in `enabled: false`.
2. As a consequence, `trend-hunter`, `calculadora-de-gorjeta`, `general.execute-goal`, `research.web-research`, and `script-director` are loaded as disabled by default and filtered out from the agent's usable skill list.
3. From Observation 2 and the parser's logic, because `tools:` is defined in YAML format with newlines, the custom parser cannot parse it. It only parses JSON block arrays (e.g. `[ { ... } ]`) on a single line or multi-line if they start/end with brackets. This results in empty `tools: []` for all script-based skills.
4. From Observation 3, if a skill is saved via the UI, the backend reconstructs `SKILL.md` omitting the `tools` array completely, deleting existing tools.
5. From Observation 4, the UI loads skills dynamically, but because of the parser bugs, script-based skills are not displayed correctly (being disabled), and the user interface lacks options to manage tool configurations.

---

## 3. Caveats
- We did not write tests directly into the main test suite (`tests/`) as this is a read-only investigation.
- We assumed the project runs on Node/Bun and that external tool scripts are executed as separate subprocesses (which we verified in `skill-script.adapter.ts`).
- We did not implement code fixes; instead, we provided exact script code and configurations as suggestions for the implementer agent.

---

## 4. Conclusion
1. The dynamic loading from the API is sufficient for instruction-only skills to show up, but manual changes are needed in the UI and parser to successfully display, configure, and maintain script-based skills (including the new `analisador-de-metricas` and `gerador-de-hashtags` skills).
2. The exact file paths, configuration settings, and script logic for both new skills must be structured with single-line JSON formatting for `tools` and unquoted boolean/approval values to work around the current parser bugs immediately. These have been written in detail to `analysis.md`.
3. We have proposed precise code fixes for `skill.parser.ts` and `skill.registry.ts` to allow standard clean YAML declarations in the future.

---

## 5. Verification Method
1. The recommendations can be verified by running the simulated parser script or loading the newly proposed `SKILL.md` configurations into the `skills/` folder and calling `GET /api/skills?full=true` to check if `analisador-de-metricas` and `gerador-de-hashtags` are returned with `enabled: true` and their custom tool definitions successfully populated in the JSON array.
2. Invalidation condition: If the API returns `tools: []` or `enabled: false` for the new skills, the workaround syntax in `SKILL.md` was not written as a single-line JSON array or contains incorrect quote characters.
