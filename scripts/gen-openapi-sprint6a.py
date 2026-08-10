#!/usr/bin/env python3
"""Generate Sprint 6A Inventory Ledger blocks (tags + paths + schemas) and insert into docs/openapi.yaml.
Scope: /api/inventory-ledger/consume (Consumer trigger endpoint) + Consumer response/status/error contracts.
NOTE (CTO #7683): InventoryMovement / StockProjection read model 本阶段不新增 read API（不为了 OpenAPI 临时新增端点）；
仅暴露已有的 consume 触发端点契约。Transfer/Conversion/Count/Costing/ReservedQty 继续 HOLD，不写契约。
"""
import sys

SRC = "docs/openapi.yaml"
content = open(SRC, encoding="utf-8").read()

TAGS = """  - name: Inventory Ledger
"""

PATHS = r"""  # ==========================================================================
  # Sprint 6A — Inventory Ledger Consumer（Transactional Outbox → 不可变 InventoryMovement + StockProjection 投影）
  # 范围（CTO #7683 Finalization Gate）：仅 consume 触发端点；Movement/Projection read model 不新增 API
  # ==========================================================================
  /api/inventory-ledger/consume:
    post:
      tags: [Inventory Ledger]
      summary: Trigger Inventory Consumer batch run (claim PENDING/retryable Outbox → consume → publish InventoryMovementCommitted)
      description: |
        触发一次 Consumer 批处理：claim（FOR UPDATE SKIP LOCKED）→ PROCESSING + lease → validate payload /
        resolve source → 五元幂等 → 锁五维 StockProjection → OUT 禁负库存 → INSERT InventoryMovement(COMMITTED) +
        UPSERT StockProjection + MARK Outbox PROCESSED 同事务 → 发布 InventoryMovementCommitted（best-effort）。
        幂等安全：重复触发不会重复入账（五元 UNIQUE + 预检）。返回批次统计。
        权限：inventory-ledger:consume。供 cron/手动触发。
      operationId: runInventoryConsumer
      security:
        - bearerAuth: []
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/InventoryConsumerRunRequest"
      responses:
        "200":
          description: Batch run summary（claimed/processed/retried/deadLettered/leaseLost + per-outbox results）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InventoryConsumerRunResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
"""

SCHEMAS = r"""
    # --------------------------------------------------------------------------
    # Sprint 6A — Inventory Ledger Consumer contracts
    # 红线：payload/响应**不含投影余额**（P10 Final：暂不发布 StockProjectionChanged）；Movement 历史不可变
    # --------------------------------------------------------------------------
    InventoryConsumerRunRequest:
      type: object
      description: 可选 limit（单轮 claim 上限；默认 20，上限 200）
      properties:
        limit:
          type: integer
          minimum: 1
          maximum: 200
          description: 单轮 claim 上限（可选，默认 20）

    InventoryConsumerRunResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [claimed, processed, retried, deadLettered, leaseLost, results]
          properties:
            claimed: { type: integer, description: 本轮 claim 的 Outbox 数 }
            processed: { type: integer, description: 成功入账（PROCESSED + ALREADY_PROCESSED）数 }
            retried: { type: integer, description: 回 PENDING 退避重试数 }
            deadLettered: { type: integer, description: 永久失败（DEAD_LETTER）数 }
            leaseLost: { type: integer, description: lease 已被回收（LEASE_LOST，旧 worker 放弃）数 }
            results:
              type: array
              items: { $ref: "#/components/schemas/InventoryConsumerOutboxResult" }

    InventoryConsumerOutboxResult:
      type: object
      required: [outboxId, outcome]
      properties:
        outboxId: { type: string, description: OutboxMessage.id }
        outcome:
          type: string
          enum: [PROCESSED, ALREADY_PROCESSED, RETRY, DEAD_LETTER, LEASE_LOST]
          description: |
            PROCESSED（新入账）/ ALREADY_PROCESSED（五元幂等重放）/ RETRY（瞬时或业务失败退避）/
            DEAD_LETTER（永久失败：payload 非法、source 不存在或状态不符、超阈值）/ LEASE_LOST（lease 已被回收）。
        movementId: { type: string, description: 入账的 InventoryMovement.id（PROCESSED/ALREADY_PROCESSED 时） }
        movementNo: { type: string, description: 入账流水号 MV-xxxxxx（PROCESSED/ALREADY_PROCESSED 时） }
        error: { type: string, description: 失败原因（RETRY/DEAD_LETTER 时） }
"""

# ============================================================================
# Apply insertions
# ============================================================================

# 1. Tags: after "- name: Purchase Returns\n"（5B 已在 Purchase Orders 后插入）
anchor_tags = "  - name: Purchase Returns\n"
assert content.count(anchor_tags) == 1, f"tags anchor count={content.count(anchor_tags)}"
content = content.replace(anchor_tags, anchor_tags + TAGS)

# 2. Paths: before "\ncomponents:"
anchor_paths = "\ncomponents:"
assert content.count(anchor_paths) == 1, f"paths anchor count={content.count(anchor_paths)}"
content = content.replace(anchor_paths, "\n" + PATHS.rstrip("\n") + "\n\ncomponents:")

# 3. Schemas: append at end
content = content.rstrip("\n") + "\n" + SCHEMAS.rstrip("\n") + "\n"

open(SRC, "w", encoding="utf-8").write(content)
print("INSERTED OK")
print("new total lines:", content.count("\n"))
