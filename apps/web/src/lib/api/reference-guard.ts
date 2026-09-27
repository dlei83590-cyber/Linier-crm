/**
 * Reference Guard — 删除引用出处（Reference Provenance）
 *
 * 背景（问题二）：删除被引用记录时的 409 不能只说「已被…引用」，必须回答「被谁引用、多少条、
 * 哪几张单据」（引用出处），用户才知道去哪里解除引用。
 *
 * 统一输出：
 * - `message`：人类可读——「<主体>已被引用，不能删除：商机 2 条（OP-001、OP-002）；项目 1 条（PJ-001）。请先解除上述引用后重试」
 * - `details.references`：结构化出处（entity/count/samples/releaseHint），供前端与测试消费
 *
 * 口径红线：
 * - `count` 必须与拦截判定完全一致（同一 where + 未软删口径），禁止「判定用 A 条件、提示用 B 条件」；
 * - `samples` 只取真实单据编号（code/单据号），最多 3 条；条数以 count 为准，样本不足时以「等」省略；
 * - count = 0 时不执行样本查询（快乐路径零额外查询）。
 */
import type { ErrorCode } from "@/lib/api/errors";
import { failConflict } from "@/lib/api/response";

/** 出处样本上限（message 保持可读；超出部分以「等」省略，count 仍为真实总数） */
export const REFERENCE_SAMPLE_LIMIT = 3;

/** 单条引用出处 */
export interface ReferenceSource {
  /** 引用来源（业务语义名，如「商机」「采购订单」「库存流水」） */
  entity: string;
  /** 引用条数（未软删口径，与拦截判定一致） */
  count: number;
  /** 真实单据编号样本（≤ REFERENCE_SAMPLE_LIMIT） */
  samples: string[];
  /** 解除引用提示（可选，前端二次展示用） */
  releaseHint?: string;
}

/** 惰性引用探测（count 先行，仅命中时才查样本） */
export interface ReferenceProbe {
  entity: string;
  count: () => Promise<number>;
  /** 样本查询（返回真实单据编号；实现方须自行 take ≤ REFERENCE_SAMPLE_LIMIT） */
  samples?: () => Promise<string[]>;
  releaseHint?: string;
}

/** 由调用方已算出的计数构造出处；count ≤ 0 → null（便于 filter(Boolean)） */
export function referenceSource(
  entity: string,
  count: number,
  samples: string[] = [],
  releaseHint?: string,
): ReferenceSource | null {
  if (count <= 0) return null;
  return {
    entity,
    count,
    samples: samples.filter((s) => typeof s === "string" && s.length > 0).slice(0, REFERENCE_SAMPLE_LIMIT),
    ...(releaseHint ? { releaseHint } : {}),
  };
}

/** 执行探测：仅保留真实命中的引用（count > 0） */
export async function collectReferences(probes: ReferenceProbe[]): Promise<ReferenceSource[]> {
  const collected = await Promise.all(
    probes.map(async (probe) => {
      const count = await probe.count();
      if (count <= 0) return null;
      const samples = probe.samples ? await probe.samples() : [];
      return referenceSource(probe.entity, count, samples, probe.releaseHint);
    }),
  );
  return collected.filter((r): r is ReferenceSource => r !== null);
}

/** 人类可读出处（实体 + 条数 + 单据编号样本） */
export function formatReferenceMessage(
  subject: string,
  references: ReferenceSource[],
  action = "删除",
): string {
  const parts = references.map((r) =>
    r.samples.length > 0
      ? `${r.entity} ${r.count} 条（${r.samples.join("、")}${r.count > r.samples.length ? " 等" : ""}）`
      : `${r.entity} ${r.count} 条`,
  );
  return `${subject}已被引用，不能${action}：${parts.join("；")}。请先解除上述引用后重试`;
}

/** 组装 409 引用冲突（references 必须非空——空引用是编程错误，fail fast） */
export function failReferenceConflict(
  code: ErrorCode,
  subject: string,
  references: ReferenceSource[],
  action = "删除",
) {
  if (references.length === 0) {
    throw new Error("failReferenceConflict: references 不能为空（无引用时不得走引用拦截分支）");
  }
  return failConflict(code, formatReferenceMessage(subject, references, action), { references });
}

/**
 * 引用拦截：命中 → 返回 409（含出处）；未命中 → 返回 null（调用方继续执行删除）。
 * subject 用业务主体 + 编号（如 `物料「ITM-001」`），禁止裸 UUID（前端红线：不展示 raw DB ID）。
 */
export async function referenceBlocked(
  code: ErrorCode,
  subject: string,
  probes: ReferenceProbe[],
  action = "删除",
): Promise<Response | null> {
  const references = await collectReferences(probes);
  if (references.length === 0) return null;
  return failReferenceConflict(code, subject, references, action);
}
