import type { Prisma, PartnerType, Supplier } from "@prisma/client";

/**
 * 供应商档案自动建档（用户报告：「新增采购单供应商为空，没有关联到往来单位」）
 *
 * 根因：采购 / 收货 / 退货 / 供应商发票 / 付款的供应商下拉一律消费 GET /api/suppliers，
 * 而 Supplier 档案只能由「专门建档」动作产生；往来单位（BusinessPartner）保存时并不建档。
 * 用户在主数据新建 type=SUPPLIER/BOTH 的往来单位后，供应商下拉始终为空 → 采购单无法创建。
 *
 * 本模块把「往来单位 type=SUPPLIER/BOTH ⇒ 供应商档案存在」收敛为一条幂等事实：
 * - Supplier 是 BusinessPartner 的角色扩展（schema：partnerId @unique，1:1），不是平行主档；
 * - 幂等：已有档案（含软删/停用）一律复用并复活，绝不重复建；
 * - 编码：默认沿用往来单位编码；若该编码已被**其他**档案占用（历史数据），
 *   退化为「编码-往来单位 id 尾段[-n]」的确定性候选，仍冲突则 fail loud（不静默改名）；
 * - 只写 role=SUPPLIER 角色行 + 档案本身，不改动任何已存在的档案业务字段
 *   （status/rating/账期/资质等仍由供应商档案页维护）。
 */

type TxClient = Prisma.TransactionClient;

export interface SupplierPartnerLike {
  id: string;
  code: string;
  name: string;
  type: PartnerType;
}

/** type=SUPPLIER/BOTH 的往来单位才具备供应商角色（与 POST /api/suppliers 的建档前置校验一致） */
export function isSupplierArchiveType(type: string | null | undefined): boolean {
  return type === "SUPPLIER" || type === "BOTH";
}

/** 确定性候选编码（不含随机值：同样输入必然收敛到同一结果，便于回放与重试） */
function candidateCodes(partner: SupplierPartnerLike): string[] {
  const suffix = partner.id.slice(-6);
  return [
    partner.code,
    `${partner.code}-${suffix}`,
    `${partner.code}-${suffix}-2`,
    `${partner.code}-${suffix}-3`,
  ];
}

/**
 * 保证往来单位存在 1:1 供应商档案；返回档案（非供应商类型返回 null）。
 *
 * 必须在调用方的事务内执行（与往来单位写入同事务）：档案建档失败即整体回滚，
 * 不允许出现「往来单位是供应商但供应商档案缺失」的半成功事实。
 */
export async function ensureSupplierArchive(
  tx: TxClient,
  partner: SupplierPartnerLike,
  actorId?: string | null,
): Promise<Supplier | null> {
  if (!isSupplierArchiveType(partner.type)) return null;

  // 角色行（BusinessPartnerRole，roleType=SUPPLIER）与档案同步存在，保持与 POST /api/suppliers 一致
  await tx.businessPartnerRole.upsert({
    where: { partnerId_roleType: { partnerId: partner.id, roleType: "SUPPLIER" } },
    update: { deletedAt: null },
    create: { partnerId: partner.id, roleType: "SUPPLIER", createdById: actorId ?? null, updatedById: actorId ?? null },
  });

  const existing = await tx.supplier.findFirst({ where: { partnerId: partner.id } });
  if (existing) {
    // 1:1 唯一：软删 / 停用的档案只能复活，不能另建
    if (existing.deletedAt !== null || !existing.isActive) {
      return tx.supplier.update({
        where: { id: existing.id },
        data: { deletedAt: null, isActive: true, updatedById: actorId ?? null },
      });
    }
    return existing;
  }

  for (const code of candidateCodes(partner)) {
    const codeTaken = await tx.supplier.findUnique({ where: { code } });
    if (codeTaken) continue; // 编码被其他档案占用（历史数据）→ 试下一个确定性候选
    return tx.supplier.create({
      data: {
        code,
        name: partner.name,
        partnerId: partner.id,
        status: "POTENTIAL",
        currency: "CNY",
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
    });
  }

  // 不静默改名、不静默跳过：编码空间耗尽属于数据异常，必须让调用方回滚并暴露
  throw new Error(`SUPPLIER_ARCHIVE_CODE_EXHAUSTED:${partner.code}`);
}
