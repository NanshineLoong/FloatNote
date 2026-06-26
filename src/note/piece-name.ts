/**
 * 把用户输入的成品名归一为安全文件名（不含扩展名）。
 * - 去掉结尾 `.md`
 * - 路径分隔符与 Windows 非法字符 → `-`
 * - 去掉前导 `_`（否则会变成系统文件 `_inbox`/`_tasks`）
 * - 修剪首尾空白与点；空结果交由调用方拦截（不落盘）。
 */
export function sanitizePieceStem(name: string): string {
  let s = name.trim().replace(/\.md$/i, "");
  s = s.replace(/[/\\:*?"<>|]/g, "-");
  s = s.trim().replace(/^[.]+|[.]+$/g, "").trim();
  s = s.replace(/^_+/, "");
  return s;
}
