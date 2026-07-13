## 2026-07-13T19:10:58Z
You are teamwork_preview_worker (Worker).
Your working directory is: d:\apps\mrchicken\.agents\worker_skills

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT
hardcode test results, create dummy/facade implementations, or
circumvent the intended task. A Forensic Auditor will independently
verify your work. Integrity violations WILL be detected and your
work WILL be rejected.

TASK:
1. Read the Explorer 1 report at `d:\apps\mrchicken\.agents\explorer_skills_1\analysis.md` and Explorer 2 report at `d:\apps\mrchicken\.agents\explorer_skills_2\analysis.md`.
2. Fix the parser bugs in `services/skills/skill.parser.ts`:
   - Clean quotes from the `enabled` check: ensure the boolean string comparison strips outer double quotes, i.e., `value.replace(/^"|"$/g, '').trim() === "true"`.
   - Implement correct parsing of the `tools` array in frontmatter when it is defined as a YAML list (like in `trend-hunter` where entries start with `  - id: ...`). Ensure this parser is robust.
3. Fix the registry saving bug in `services/skills/skill.registry.ts`:
   - In `save()`, ensure the `tools` array is correctly serialized back into the generated frontmatter of `SKILL.md` (e.g., `tools: ${JSON.stringify(skill.tools || [])}`).
4. Create the `analisador-de-metricas` skill:
   - Configuration file: `skills/analisador-de-metricas/SKILL.md`
   - Tool script: `skills/analisador-de-metricas/scripts/analyze-metrics.ts`
   Use the specifications from the Explorer reports.
5. Create the `gerador-de-hashtags` skill:
   - Configuration file: `skills/gerador-de-hashtags/SKILL.md`
   - Tool script: `skills/gerador-de-hashtags/scripts/generate-hashtags.ts`
   Use the specifications from the Explorer reports.
6. Enhance `components/settings/SkillsSettingsPanel.tsx` to display a premium and modern UI:
   - Expose inputs/dropdown for `approvalMode` (`plan`, `always`, `never`).
   - Expose options/checkboxes for `requiredCapabilities` (`web`, `content`, `system`).
   - Display a list/readout of associated custom `tools` (scripts).
   - Add a search/filter bar at the top of the sidebar.
   - Differentiate built-in skills (like "general.execute-goal", "research.web-research", "content.create-short-video") from custom ones (like our newly created skills) using badges ("Built-in" vs "Custom").
   - Display `version` next to the skill ID in the detail view.
   - Maintain the premium dark glassmorphic styling.
7. Run the verification:
   - Execute Next.js build using `npm run build` and ensure there are no compilation or route errors.
   - Execute orchestrator tests using `npm run test:orchestrator` and make sure they pass.
8. Document all your changes, build output, and test command results in your handoff report at `d:\apps\mrchicken\.agents\worker_skills\handoff.md`. Notify the parent orchestrator (be4df9e1-3f97-42eb-b7e0-c6dc50a04bb0) when complete.
