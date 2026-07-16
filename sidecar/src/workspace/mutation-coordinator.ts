import {
  prepareEdit,
  prepareTagMutation,
  prepareWrite,
  type EditInput,
  type TagMutationInput,
  type TagMutationTool,
  type WriteInput,
} from "./mutations.js";
import type { PreparedMutation, WorkspaceClient } from "./types.js";

export interface MutationReviewResult {
  allowed: boolean;
  lease?: string;
  writeMode?: "direct" | "snapshot";
  error?: string;
}

export interface MutationCommitResult {
  ok: boolean;
  version?: number;
  error?: string;
}

export interface MutationHost {
  review(
    toolCallId: string,
    toolName: string,
    mutation: PreparedMutation,
  ): Promise<MutationReviewResult>;
  commit(toolCallId: string, lease: string): Promise<MutationCommitResult>;
}

export interface MutationCoordinatorDeps extends MutationHost {
  workspace: WorkspaceClient;
}

const TAG_TOOLS = new Set<TagMutationTool>([
  "tag_text",
  "tag_create",
  "tag_update",
  "tag_delete",
]);

export class MutationCoordinator {
  private readonly approvals = new Map<string, { lease: string }>();

  constructor(private readonly deps: MutationCoordinatorDeps) {}

  async prepareForHook(toolCallId: string, toolName: string, input: unknown): Promise<void> {
    if (this.approvals.has(toolCallId)) {
      throw new Error("该工具调用已经取得写入许可");
    }
    const mutation = await this.prepare(toolName, input);
    const result = await this.deps.review(toolCallId, toolName, mutation);
    if (!result.allowed) {
      throw new Error(result.error || "用户拒绝了此操作");
    }
    if (!result.lease) {
      throw new Error(result.error || "主机未返回写入许可");
    }
    this.approvals.set(toolCallId, { lease: result.lease });
  }

  async commitForTool(toolCallId: string): Promise<MutationCommitResult> {
    const approved = this.approvals.get(toolCallId);
    if (!approved) throw new Error("没有可用的写入许可");
    this.approvals.delete(toolCallId);
    const result = await this.deps.commit(toolCallId, approved.lease);
    if (!result.ok) throw new Error(result.error || "写入失败");
    return result;
  }

  clear(): void {
    this.approvals.clear();
  }

  private prepare(toolName: string, input: unknown): Promise<PreparedMutation> {
    if (toolName === "edit") {
      return prepareEdit(this.deps.workspace, input as EditInput);
    }
    if (toolName === "write") {
      return prepareWrite(this.deps.workspace, input as WriteInput);
    }
    if (TAG_TOOLS.has(toolName as TagMutationTool)) {
      return prepareTagMutation(
        this.deps.workspace,
        toolName as TagMutationTool,
        input as TagMutationInput,
      );
    }
    throw new Error(`不支持的变更工具：${toolName}`);
  }
}
