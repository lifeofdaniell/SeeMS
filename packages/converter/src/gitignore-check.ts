import fs from "fs-extra";
import path from "path";
import ignore from "ignore";

export async function isSeeMsIgnored(projectDir: string): Promise<boolean> {
  const gitignorePath = path.join(projectDir, ".gitignore");
  if (!(await fs.pathExists(gitignorePath))) return false;

  const content = await fs.readFile(gitignorePath, "utf-8");
  const ig = ignore().add(content);

  // Test a file inside .see-ms — if it's ignored, the folder is being excluded
  return ig.ignores(".see-ms/generated.json");
}
