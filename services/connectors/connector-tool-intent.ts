import { skillRegistry } from "../skills/skill.registry.ts";
import { extractToolApprovalToken } from "../tools/tool-approval.service.ts";

export function connectorShouldUseExternalTools(prompt: string): boolean {
  if (extractToolApprovalToken(prompt)) return true;
  const selectedSkill = skillRegistry.select(prompt);
  return (
    selectedSkill.id !== "general.execute-goal" &&
    Boolean(
      selectedSkill.tools?.length ||
      selectedSkill.preferredTools.length,
    )
  );
}
