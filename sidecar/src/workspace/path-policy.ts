export function normalizeWorkspaceRoot(value?: string): "." {
  if (value === undefined || value === "" || value === ".") return ".";
  throw new Error("路径必须是当前项目工作区根目录");
}

export function validateProjectPath(candidate: string, listedPaths: readonly string[]): string {
  if (
    !candidate
    || candidate === "."
    || candidate.includes("/")
    || candidate.includes("\\")
    || candidate.includes("\0")
    || candidate === ".."
    || /^[A-Za-z]:/.test(candidate)
  ) {
    throw new Error("路径必须是当前项目根目录中已列出的笔记");
  }
  if (!listedPaths.includes(candidate)) {
    throw new Error("该文件不属于当前项目可见笔记");
  }
  return candidate;
}
