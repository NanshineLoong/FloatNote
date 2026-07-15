/** Stable tag definition stored by the Inbox v2 codec. */
export interface TagDef {
  id: string;
  name: string;
  color: string;
}

export const MAX_TAG_NAME_LENGTH = 80;

export function isValidTagName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MAX_TAG_NAME_LENGTH && !/[\r\n]/.test(name);
}
