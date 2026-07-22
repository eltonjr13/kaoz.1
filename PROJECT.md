# Project: Mr. Chicken Skills Tab Expansion

## Architecture
- **Skills Directory (`skills/`)**: Contains self-contained subfolders for each skill.
  - Each skill has a `SKILL.md` with YAML frontmatter defining name, description, version, and tools configuration, followed by markdown instructions for the AI agent.
  - Each skill can have a `scripts/` directory containing executable scripts (e.g., `.ts`, `.js`, `.py`) that perform the actual tool work.
- **Skills Registry (`services/skills/`)**:
  - `skill.registry.ts`: Dynamically reads, caches, parses, and saves skills from/to the `skills/` directory.
  - `skill.parser.ts`: Parses `SKILL.md` files (frontmatter and instructions).
  - `skill.types.ts`: Defines typescript types for `KaozSkill` and `SkillToolDefinition`.
- **UI Tab Integration**:
  - `app/(dashboard)/settings/page.tsx` renders `<SkillsSettingsPanel />` when `activeTab === "skills"`.
  - `components/settings/SkillsSettingsPanel.tsx` fetches skills from `/api/skills?full=true` and allows creating/editing them.
  - `services/tools/tool.registry.ts` exposes enabled skill tools to the active agent and Flow execution paths.

## Code Layout
- `skills/analisador-de-metricas/SKILL.md` - Definition and prompt instructions for metric analyzer skill.
- `skills/analisador-de-metricas/scripts/analyze-metrics.ts` - Tool implementation script for metric analyzer.
- `skills/gerador-de-hashtags/SKILL.md` - Definition and prompt instructions for hashtag generator skill.
- `skills/gerador-de-hashtags/scripts/generate-hashtags.ts` - Tool implementation script for hashtag generator.
- `components/settings/SkillsSettingsPanel.tsx` - Skills Tab UI where skills are listed and managed.
- `app/api/skills/route.ts` - API endpoint for retrieving and saving skills.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Explore existing skills & UI | Run exploration agent to check `skills/` structure, API, and UI | None | DONE |
| 2 | Create `analisador-de-metricas` skill | Write `SKILL.md` and script to analyze video engagement metrics | M1 | DONE |
| 3 | Create `gerador-de-hashtags` skill | Write `SKILL.md` and script to generate tags based on niche/content | M1 | DONE |
| 4 | UI Integration & Verification | Verify new skills show in Settings and are available through the active tool registry | M2, M3 | DONE |

## Interface Contracts
### API Endpoint ↔ Skills Settings Panel
- **GET `/api/skills?full=true`**: Returns list of all installed skills.
- **POST `/api/skills`**: Saves a skill definition (creates directory and writes `SKILL.md`).
- **Input Schema**:
  ```json
  {
    "id": "skill-id",
    "name": "Skill Name",
    "description": "Skill Description",
    "instructions": "Markdown instructions",
    "version": "1.0.0",
    "enabled": true,
    "approvalMode": "plan",
    "preferredTools": [],
    "requiredCapabilities": [],
    "tools": []
  }
  ```
