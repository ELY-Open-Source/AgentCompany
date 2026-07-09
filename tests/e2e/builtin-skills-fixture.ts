import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A miniature of the real bundled catalogue: the forced humanizer skill plus
 * one category of flat skills. E2E launches point
 * AGENTCOMPANY_NEW_BUILTIN_SKILLS_DIR here so startup imports stay small and
 * hermetic instead of reading the full repo bundle.
 */
export function seedBuiltinSkillsFixture(root: string): string {
  mkdirSync(join(root, "humanizer"), { recursive: true });
  writeFileSync(
    join(root, "humanizer", "SKILL.md"),
    "---\nname: humanizer\nversion: 2.1.1\ndescription: |\n  Remove signs of AI-generated writing from text.\n---\n\nWrite like a person.\n",
    "utf8",
  );
  mkdirSync(join(root, "engineering"), { recursive: true });
  writeFileSync(
    join(root, "engineering", "engineering-backend-architect.md"),
    "---\nname: Backend Architect\ndescription: Scalable system design specialist.\n---\n\nDesign the systems that hold everything up.\n",
    "utf8",
  );
  return root;
}
