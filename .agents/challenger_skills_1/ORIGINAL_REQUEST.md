## 2026-07-13T19:23:35Z
You are teamwork_preview_challenger (Challenger 1).
Your working directory is: d:\apps\mrchicken\.agents\challenger_skills_1
Your task:
1. Verify the runtime correctness of both `analisador-de-metricas` and `gerador-de-hashtags` scripts.
2. Manually execute each script using `npx tsx <scriptPath>` with sample input arguments via the env variable `KAOZ_SKILL_ARGS`.
   - For `analisador-de-metricas`: test normal inputs (e.g. 1000 views, 100 likes, 10 comments, 5 shares, 60s duration, 30s retention) and boundaries (e.g. 0 views/duration, negative inputs, extreme values).
   - For `gerador-de-hashtags`: test different niches (e.g. tecnologia, finanças, culinária, fitness) and platforms (e.g. tiktok, instagram, youtube, all).
3. Confirm that the output of each script is valid JSON written to stdout, and the process exits with `0` for valid inputs and `1` (or error output) for invalid inputs.
4. Document the execution commands, inputs, and outputs in d:\apps\mrchicken\.agents\challenger_skills_1\challenger_report.md and notify the parent orchestrator (be4df9e1-3f97-42eb-b7e0-c6dc50a04bb0).
Do NOT write code or modify files. Just execute tests.
