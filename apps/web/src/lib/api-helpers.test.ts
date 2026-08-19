import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { assertProjectWritable } from "@/lib/api-helpers";

/**
 * Project Lifecycle 契约单测（CTO P2 G-1）：assertProjectWritable — CLOSED 写门禁（B2-0/L1-A）
 * 覆盖：项目不存在（404）/ CLOSED fail-closed（409）/ 可写（ok:true 带 locked project）。
 * 锁序：Project header FOR UPDATE → Gate → mutation（事务内调用方职责）。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(rows: unknown[]) {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient;
}

describe("assertProjectWritable — CLOSED 写门禁", () => {
  it("项目不存在（FOR UPDATE 无行）→ 409（failConflict 固定 409；body code=NOT_FOUND 供客户端识别）", async () => {
    const tx = makeTx([]);
    const r = await assertProjectWritable(tx, "p-x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(409);
  });

  it("stage === CLOSED → 409 fail-closed（结项后禁止子资源写）", async () => {
    const tx = makeTx([{ id: "p1", stage: "CLOSED", version: 3, paymentStatus: "UNPAID", receivableBalance: null }]);
    const r = await assertProjectWritable(tx, "p1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(409);
  });

  it("非 CLOSED → ok:true 携带 locked project（锁后权威版本）", async () => {
    const tx = makeTx([{ id: "p1", stage: "MASS_SUPPLY", version: 7, paymentStatus: "PARTIALLY_PAID", receivableBalance: null }]);
    const r = await assertProjectWritable(tx, "p1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.id).toBe("p1");
    expect(r.project.stage).toBe("MASS_SUPPLY");
    expect(r.project.version).toBe(7);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});