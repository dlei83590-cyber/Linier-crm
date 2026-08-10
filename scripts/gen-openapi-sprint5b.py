#!/usr/bin/env python3
"""Generate Sprint 5B Purchase blocks (tags + paths + schemas) and insert into docs/openapi.yaml.
Modules: PurchaseReceipt / Inspection / WarehouseReceipt / PurchaseReturn (21 endpoints + ~30 schemas).
"""
import sys

SRC = "docs/openapi.yaml"
content = open(SRC, encoding="utf-8").read()

TAGS = """  - name: Purchase Receipts
  - name: Inspections
  - name: Warehouse Receipts
  - name: Purchase Returns
"""

PATHS = r"""  # ==========================================================================
  # Sprint 5B — Purchase Receipt（到货/收货事实，D1 第一层；只有 CONFIRMED/PARTIALLY_RECEIVED PO 可收，RECEIVED 禁普通新增收货 D9）
  # ==========================================================================
  /api/purchase-receipts:
    get:
      tags: [Purchase Receipts]
      summary: List purchase receipts (paginated, filterable by code/purchaseOrderId/status)
      description: |
        收货事实源列表。过滤：code（模糊 insensitive）/ purchaseOrderId / status（DRAFT|RECEIVED|CANCELLED）。
        软删除已过滤；每项含 PO 摘要与 lines 计数。
      operationId: listPurchaseReceipts
      security:
        - bearerAuth: []
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: pageSize
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: code
          in: query
          schema: { type: string, description: 收货单号模糊查询（insensitive） }
        - name: purchaseOrderId
          in: query
          schema: { type: string }
        - name: status
          in: query
          schema: { type: string, description: PurchaseReceiptStatus 存储态 }
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReceiptListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
    post:
      tags: [Purchase Receipts]
      summary: Create Purchase Receipt (DRAFT; arrival fact; normal receipt does NOT go through approval P1b)
      description: |
        创建收货单（DRAFT，创建即取号 PRC-xxxxxx）。**服务端门禁（规则①/D9）**：PO 必须存在且状态为
        CONFIRMED / PARTIALLY_RECEIVED（RECEIVED 禁普通新增收货 → 409 PO_STATE_FORBIDDEN，走 Reopen/Amendment/Over-Receipt Exception）；
        Supplier 必须有效。行校验：**B②（CTO #6963/#7014）同一 Receipt 内一个 PO Line 只能出现一次**（防重复引用导致
        receivedQty 少记 → 400 DUPLICATE_PO_LINE）；行必须属于该 PO（LINE_PO_MISMATCH）；WAREHOUSE 行必须有有效 warehouseId
        （DIRECT_PROJECT 行不要求，P4）；warehouseId 若提供必须有效。数量事实（规则④）：quantity>0；
        0 <= rejectedOnReceiptQty <= quantity（现场即拒收，**不计入 PO receivedQty**）。DRAFT 创建不发领域事件（仅 AuditLog）。
        权限：purchase-receipt:create。
      operationId: createPurchaseReceipt
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseReceiptCreate"
      responses:
        "201":
          description: Created（status=DRAFT + code）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReceiptResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          description: Conflict（PO 状态不允许 / 行重复或不属于 PO / warehouse 无效）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-receipts/{id}:
    get:
      tags: [Purchase Receipts]
      summary: Get purchase receipt detail
      operationId: getPurchaseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: Detail（PO/supplier/warehouse 摘要 + lines（PO Line/Item/UOM））
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReceiptResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      tags: [Purchase Receipts]
      summary: Update purchase receipt (DRAFT only; version optimistic lock; lines full replace)
      description: |
        仅 DRAFT 可更新；version 乐观锁（409 VERSION_CONFLICT）；行整体替换并重新过 C 组校验；
        **receivedQty / remainingReceiveQty 禁止客户端提交**（schema 无此字段；5B 唯一回写方）。
        权限：purchase-receipt:edit。
      operationId: updatePurchaseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseReceiptUpdate"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReceiptResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（非 DRAFT / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-receipts/{id}/receive:
    post:
      tags: [Purchase Receipts]
      summary: Receive goods (DRAFT → RECEIVED; PO Line projection write-back + PO aggregate status)
      description: |
        **收货真 Gate（普通收货不走审批 P1b）**。事务内 FOR UPDATE 锁 PO Line（排序锁行防死锁）+ CAS 幂等。
        状态门禁：仅 DRAFT 可 Receive（已 RECEIVED → 409 ALREADY_RECEIVED；CANCELLED → 409 INVALID_STATE）。
        数量公式（规则④/P7）：**receivedQty_new = receivedQty_old + accepted**，accepted = quantity - rejectedOnReceiptQty
        （**禁 receivedQty += quantity**；现场拒收不计入）。超收 ceiling（规则⑥）：newReceivedQty > PO Line quantity ×
        (1 + effectiveToleranceRate)（System Default 0%；tolerance 只用于 ceiling，**不改 remainingReceiveQty 语义**）→ 409 OVER_RECEIPT。
        remainingReceiveQty = max(quantity - newReceivedQty, 0) 服务端唯一计算（规则⑦）。
        投影回写 PO Line（receivedQty/remainingReceiveQty + version 递增）；PO 聚合状态：全部行 receivedQty>=quantity → RECEIVED，
        否则 PARTIALLY_RECEIVED（规则⑧）。事务成功后发布 PurchaseReceiptReceived + PO 投影事件（PartiallyReceived/Received）。
        **5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）。权限：purchase-receipt:edit。
      operationId: receivePurchaseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseReceiptReceive"
      responses:
        "200":
          description: OK（status=RECEIVED + receivedAt + poStatus）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReceiptReceiveResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（已收货幂等 / 状态不允许 / 超收 / 行不属于 PO / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-receipts/{id}/cancel:
    post:
      tags: [Purchase Receipts]
      summary: Cancel purchase receipt (DRAFT only; RECEIVED fact cannot be undone by cancel CTO #6944)
      description: |
        仅 DRAFT 可取消（CAS：id + version + status=DRAFT 原子命中，成功递增 version）。
        **RECEIVED 收货事实不得经 cancel 撤销 → 409 CANCEL_FORBIDDEN**；CANCELLED → 409 INVALID_STATE。
        权限：purchase-receipt:close（对齐 PO cancel 先例）。
      operationId: cancelPurchaseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/VersionOnlyRequest"
      responses:
        "200":
          description: OK（status=CANCELLED）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReceiptCancelResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（已收货禁取消 / 状态不允许 / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  # ==========================================================================
  # Sprint 5B — Inspection（质检唯一事实源，D8；inspectableQty = quantity - rejectedOnReceiptQty）
  # ==========================================================================
  /api/inspections:
    get:
      tags: [Inspections]
      summary: List inspections (paginated, filterable by purchaseReceiptLineId/result)
      description: |
        质检记录列表。过滤：purchaseReceiptLineId / result（PENDING|QUALIFIED|PARTIAL|REJECTED）。
        软删除已过滤。
      operationId: listInspections
      security:
        - bearerAuth: []
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: pageSize
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: purchaseReceiptLineId
          in: query
          schema: { type: string }
        - name: result
          in: query
          schema: { type: string, description: InspectionResult 存储态 }
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InspectionListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
    post:
      tags: [Inspections]
      summary: Create inspection (PENDING; bound to a RECEIVED PurchaseReceiptLine; SKIP/SPOT/FULL)
      description: |
        创建质检记录（result=PENDING）。**来源必须已 RECEIVED 的 PurchaseReceiptLine（CTO #7045 → 409 LINE_NOT_RECEIVED）**；
        **一次 Inspection 即最终结果**：同一 PurchaseReceiptLine 只有一个有效 Inspection（DB unique 并发拒绝 → 409 ALREADY_EXISTS）。
        inspectionMode：SKIP（免检）/ SPOT / FULL。数量在 complete 时定稿，创建时不提交数量。
        权限：inspection:create。
      operationId: createInspection
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/InspectionCreate"
      responses:
        "201":
          description: Created（result=PENDING）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InspectionResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          description: Conflict（来源未收货 / 已存在有效检验 / 行不存在）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/inspections/{id}:
    get:
      tags: [Inspections]
      summary: Get inspection detail
      operationId: getInspection
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: Detail（收货行/检验模式/结论/数量/检验人）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InspectionResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      tags: [Inspections]
      summary: Update inspection (PENDING only; version lock; mode/remark only, quantities fixed at complete)
      description: |
        仅 PENDING 可更新；version 乐观锁。**只允许改 inspectionMode / remark——数量在 complete 时定稿
        （schema 无数量字段，PATCH 禁改）**。权限：inspection:edit。
      operationId: updateInspection
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/InspectionUpdate"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InspectionResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（非 PENDING / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/inspections/{id}/complete:
    post:
      tags: [Inspections]
      summary: Complete inspection (真 Gate; SPOT/FULL submit qualifiedQty+rejectedQty; SKIP auto-QUALIFIED)
      description: |
        **质检结论落定（D8）**。数量恒等式：**qualifiedQty + rejectedQty === inspectableQty**（= 强制，
        inspectableQty = quantity - rejectedOnReceiptQty，不含现场拒收 → 不符 409 QUANTITY_INVALID）。
        SKIP 免检：服务端强制 result=QUALIFIED + qualifiedQty=inspectableQty + rejectedQty=0（**不绕过 Inspection 记录**）。
        result 服务端推导（QUALIFIED / PARTIAL / REJECTED），客户端不得传。CAS：id + version + result=PENDING 原子命中，
        成功递增 version；已 complete → 409 INVALID_STATE。事务成功后发布 InspectionCompleted（不含库存余额）。
        **5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）。权限：inspection:edit。
      operationId: completeInspection
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/InspectionComplete"
      responses:
        "200":
          description: OK（result + qualifiedQty + rejectedQty）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/InspectionCompleteResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（数量恒等式违反 / 无对象可检 / 已定稿 / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  # ==========================================================================
  # Sprint 5B — Warehouse Receipt（采购入库事实，D1 第二层 + P6 追溯 capture；D10：Created ≠ Posted）
  # ==========================================================================
  /api/warehouse-receipts:
    get:
      tags: [Warehouse Receipts]
      summary: List warehouse receipts (paginated, filterable by purchaseReceiptId/status)
      description: |
        入库事实列表。过滤：purchaseReceiptId / status（DRAFT|POSTED|CANCELLED）。软删除已过滤。
      operationId: listWarehouseReceipts
      security:
        - bearerAuth: []
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: pageSize
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: purchaseReceiptId
          in: query
          schema: { type: string }
        - name: status
          in: query
          schema: { type: string, description: WarehouseReceiptStatus 存储态 }
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WarehouseReceiptListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
    post:
      tags: [Warehouse Receipts]
      summary: Create Warehouse Receipt (DRAFT; consumes completed Inspection with qualifiedQty>0; P6 trace capture)
      description: |
        创建入库单（DRAFT）。**来源收货单必须已 RECEIVED（409 PURCHASE_RECEIPT_NOT_RECEIVED）**。
        入库行只能消费**已完成且 qualifiedQty > 0** 的 Inspection（组合 FK [inspectionId, purchaseReceiptLineId]
        保证 Inspection 属于同一收货行 → 409 INSPECTION_MISMATCH）；行必须属于该收货单（LINE_MISMATCH）；
        **DIRECT_PROJECT（直送）禁入库（P4 → 409 DIRECT_PROJECT_FORBIDDEN）**；warehouse 必须有效（WAREHOUSE_INVALID）；
        location 若提供必须属于同一 warehouse（LOCATION_INVALID）；quantity>0 且 ≤ 可入库余额（QUANTITY_INVALID）。
        同一入库单内一个收货行只能出现一次（DUPLICATE_LINE）。P6：批次/序列号/效期在入库层采集
        （库存追溯信息 canonical capture point）。DRAFT 创建不发领域事件（仅 AuditLog）。权限：warehouse-receipt:create。
      operationId: createWarehouseReceipt
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/WarehouseReceiptCreate"
      responses:
        "201":
          description: Created（status=DRAFT）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WarehouseReceiptResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          description: Conflict（来源未收货 / Inspection 未完成或无合格量 / 组合 FK 不匹配 / 直送禁入库 / 仓库库位无效 / 超可入库余额）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/warehouse-receipts/{id}:
    get:
      tags: [Warehouse Receipts]
      summary: Get warehouse receipt detail
      operationId: getWarehouseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: Detail（来源收货/仓库/库位/行（收货行/Inspection/数量/批次/序列号/效期））
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WarehouseReceiptResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      tags: [Warehouse Receipts]
      summary: Update warehouse receipt (DRAFT only; version lock; lines full replace)
      description: |
        仅 DRAFT 可更新；version 乐观锁；行整体替换并重新过创建校验；warehouseId 模型必填不可清空（400），
        locationId 可空（组合 FK 同属校验）。权限：warehouse-receipt:edit。
      operationId: updateWarehouseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/WarehouseReceiptUpdate"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WarehouseReceiptResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（非 DRAFT / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/warehouse-receipts/{id}/post:
    post:
      tags: [Warehouse Receipts]
      summary: Post warehouse receipt (DRAFT → POSTED; only POSTED triggers 6A InventoryMovement(IN) D10)
      description: |
        **入库过账真 Gate（D10：Created ≠ Posted）**。事务内锁 + 可入库余额校验（**POST 时含本单行，
        累计入库 ≤ qualifiedQty 防并发超入 → 409 OVER_INSPECTION_BALANCE**）+ CAS/幂等（ALREADY_POSTED → 409）。
        状态门禁：仅 DRAFT 可 Post（CANCELLED → 409 INVALID_STATE）。事务成功后发布 WarehouseReceiptPosted
        （**只有 Posted 才触发 6A InventoryMovement(IN)**，6A 消费 Posted 事件；载荷不含库存余额）。
        **5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）。权限：warehouse-receipt:edit。
      operationId: postWarehouseReceipt
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/WarehouseReceiptPost"
      responses:
        "200":
          description: OK（status=POSTED + postedAt）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WarehouseReceiptPostResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（重复过账幂等 / 状态不允许 / 超可入库余额 / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  # ==========================================================================
  # Sprint 5B — Purchase Return（采购退货独立事实，P5 非负 GR；三来源 + disposition；REPLACE_REQUIRED 同事务 reopen PO）
  # ==========================================================================
  /api/purchase-returns:
    get:
      tags: [Purchase Returns]
      summary: List purchase returns (paginated, filterable by code/purchaseOrderId/supplierId/status/returnType)
      description: |
        退货事实列表。过滤：code（模糊 insensitive）/ purchaseOrderId / supplierId / status（DRAFT|RETURNED|CANCELLED）/
        returnType（REJECTED_ON_RECEIPT|RETURN_AFTER_STOCK_IN|QUALITY_ISSUE）。软删除已过滤。
      operationId: listPurchaseReturns
      security:
        - bearerAuth: []
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: pageSize
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: code
          in: query
          schema: { type: string, description: 退货单号模糊查询（insensitive） }
        - name: purchaseOrderId
          in: query
          schema: { type: string }
        - name: supplierId
          in: query
          schema: { type: string }
        - name: status
          in: query
          schema: { type: string, description: PurchaseReturnStatus 存储态 }
        - name: returnType
          in: query
          schema: { type: string, description: PurchaseReturnType 存储态 }
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReturnListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
    post:
      tags: [Purchase Returns]
      summary: Create Purchase Return (DRAFT; three source types exactly-one FK; disposition required)
      description: |
        创建退货单（DRAFT，创建即取号 PRT-xxxxxx）。**必须有真实来源（exactly-one FK + API 强制匹配）**：
        - RECEIPT_LINE（未入库退货：收货现场拒收，不碰库存）；
        - INSPECTION（未入库退货：质检拒收，不碰库存）；
        - WAREHOUSE_RECEIPT_LINE（已入库退货：**必须来自 POSTED 入库事实** → 409 SOURCE_NOT_RETURNABLE；**不得写
          InventoryMovement(OUT)**，6A 唯一事实源）。
        来源必须属于该 PO（SOURCE_MISMATCH）；**来源可退余额（CTO Re-review Blocking ① 修正，Create 预检查与 Return Gate 同源防分叉）**：
        RECEIPT_LINE = `rejectedOnReceiptQty` / INSPECTION = `rejectedQty` / WAREHOUSE_RECEIPT_LINE = 已 POSTED 入库行 `quantity`；
        超限 → 409 OVER_SOURCE_BALANCE。行去重（同单一个来源一次，防并发超退 → 400 DUPLICATE_LINE）。disposition 必填：
        REPLACE_REQUIRED（供应商仍欠货，Return Gate 同一事务内真正 reopen PO 履约）/ CREDIT_ONLY（不自动重开待交）；
        returnReason 必填。DRAFT 创建不发领域事件（仅 AuditLog）。权限：purchase-return:create。
      operationId: createPurchaseReturn
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseReturnCreate"
      responses:
        "201":
          description: Created（status=DRAFT + code）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReturnResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          description: Conflict（来源无效/不属于 PO/不可退 / 超来源可退余额 / PO 不存在）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-returns/{id}:
    get:
      tags: [Purchase Returns]
      summary: Get purchase return detail
      operationId: getPurchaseReturn
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: Detail（PO/supplier 摘要 + lines（来源/数量/disposition/原因））
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReturnResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      tags: [Purchase Returns]
      summary: Update purchase return (DRAFT only; version lock; lines full replace)
      description: |
        仅 DRAFT 可更新；version 乐观锁；行整体替换并重新过创建校验（来源/数量/disposition）。
        权限：purchase-return:edit。
      operationId: updatePurchaseReturn
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseReturnUpdate"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReturnResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（非 DRAFT / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-returns/{id}/return:
    post:
      tags: [Purchase Returns]
      summary: Complete return (DRAFT → RETURNED; lock-based re-check; REPLACE_REQUIRED reopens PO in same txn)
      description: |
        **退货真 Gate（CTO #7219 + Re-review 98/100 FINAL）**。事务内 FOR UPDATE 锁 PurchaseReturn + 真实来源行
        （PurchaseReceiptLine / WarehouseReceiptLine / Inspection）+ CAS/幂等（ALREADY_RETURNED → 409）。
        **防并发超退**：锁内重算累计 RETURNED（仅 RETURNED 单占用；本单 DRAFT 未过账不计入，不双计）→ 本单行 ≤ 来源可退余额
        （口径同 Create：rejectedOnReceiptQty / rejectedQty / POSTED 入库行 quantity）→ 409 OVER_SOURCE_BALANCE。
        **REPLACE_REQUIRED 同一事务内真正 reopen PO 履约（Blocking ②）**：INSPECTION / WAREHOUSE_RECEIPT_LINE 来源
        按 PO Line 聚合 reopen 数量、锁 PurchaseOrderLine FOR UPDATE、`receivedQty -= returnQty`、`remainingReceiveQty`
        重开待交（max(quantity - receivedQty, 0)，与 receive canonical helper 一致）；**RECEIPT_LINE(rejectedOnReceiptQty)
        收货时未计入 receivedQty，供应商本就欠货，不重复 reopen**；原始 PurchaseReceipt/Inspection/WarehouseReceipt 事实不倒改；
        PO 原状态 RECEIVED + 有效 reopen → 重聚回 PARTIALLY_RECEIVED（防自相矛盾）。**line-level disposition（Minor）**：
        PurchaseReturned 事件/Audit 载荷含 `lines[]`（lineId/sourceRefType/sourceId/quantity/disposition）+
        `hasReplacementRequired` / `hasCreditOnly`（弃第一行单值冒充整单）。**5B 禁写 InventoryMovement(OUT) / Stock**
        （6A 唯一事实源）；财务冲减/红字发票/AP 属 5C。权限：purchase-return:edit。
      operationId: completePurchaseReturn
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseReturnReturn"
      responses:
        "200":
          description: OK（status=RETURNED + returnedAt）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseReturnReturnResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（重复退货幂等 / 状态不允许 / 超来源可退余额 / 版本冲突）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
"""

SCHEMAS = r"""
    # --------------------------------------------------------------------------
    # Sprint 5B — PurchaseReceipt / Inspection / WarehouseReceipt / PurchaseReturn
    # 红线：5B 永不直接写 Stock / InventoryMovement（6A 唯一事实源）
    # --------------------------------------------------------------------------
    PurchaseReceiptStatus:
      type: string
      enum: [DRAFT, RECEIVED, CANCELLED]
      description: |
        收货事实生命周期：DRAFT（创建即取号 PRC-）→ RECEIVED（Receive 落定，事实不可经 cancel 撤销）→ CANCELLED（仅 DRAFT 可取消）。

    PurchaseReceiptLineCreate:
      type: object
      required: [purchaseOrderLineId, quantity]
      properties:
        purchaseOrderLineId: { type: string, description: 溯源 PO Line（行级溯源；服务端校验属于同一 PO） }
        quantity: { type: number, format: decimal, description: 物理到货毛数量（> 0；可 <、=、> PO 订购量） }
        visibleDamageQty: { type: number, format: decimal, default: 0, description: 收货现场可见损坏 }
        rejectedOnReceiptQty: { type: number, format: decimal, default: 0, description: 现场即拒收（0 <= x <= quantity；**不计入 receivedQty**） }
        deliveryAddress: { type: [string, "null"], maxLength: 500, description: 直送地址（DIRECT_PROJECT） }
        receiver: { type: [string, "null"], maxLength: 200 }
        proof: { type: [string, "null"], maxLength: 500, description: 签收证明/附件引用 }
        remark: { type: [string, "null"], maxLength: 500 }

    PurchaseReceiptCreate:
      type: object
      required: [purchaseOrderId, lines]
      description: 创建收货单（DRAFT；warehouseId 仅 WAREHOUSE 场景必填；DIRECT_PROJECT 不要求）
      properties:
        purchaseOrderId: { type: string, minLength: 1 }
        warehouseId: { type: string, description: 公司仓库到货地点（仅 WAREHOUSE 收货场景） }
        remark: { type: [string, "null"], maxLength: 500 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PurchaseReceiptLineCreate" }

    PurchaseReceiptUpdate:
      type: object
      required: [version]
      description: 仅 DRAFT；行整体替换；receivedQty/remainingReceiveQty 禁客户端提交（5B 唯一回写方）
      properties:
        version: { type: integer, minimum: 1 }
        warehouseId: { type: [string, "null"] }
        remark: { type: [string, "null"], maxLength: 500 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PurchaseReceiptLineCreate" }

    PurchaseReceiptReceive:
      type: object
      required: [version]
      description: 收货 Gate（DRAFT → RECEIVED；version 乐观锁 + 幂等 ALREADY_RECEIVED）
      properties:
        version: { type: integer, minimum: 1 }

    PurchaseReceipt:
      type: object
      properties:
        id: { type: string }
        code: { type: string, description: PRC- 前缀取号 }
        purchaseOrderId: { type: string }
        warehouseId: { type: [string, "null"] }
        status: { $ref: "#/components/schemas/PurchaseReceiptStatus" }
        receivedAt: { type: [string, "null"], format: date-time }
        receivedById: { type: [string, "null"] }
        version: { type: integer }
        lines:
          type: array
          items: { type: object }

    PurchaseReceiptResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data: { $ref: "#/components/schemas/PurchaseReceipt" }

    PurchaseReceiptListResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          properties:
            total: { type: integer }
            page: { type: integer }
            pageSize: { type: integer }
            items:
              type: array
              items: { $ref: "#/components/schemas/PurchaseReceipt" }

    PurchaseReceiptReceiveResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, code, status, receivedAt, poStatus]
          properties:
            id: { type: string }
            code: { type: string }
            status: { type: string, description: RECEIVED }
            receivedAt: { type: string, format: date-time }
            poStatus: { type: string, description: PO 聚合状态（RECEIVED | PARTIALLY_RECEIVED） }

    PurchaseReceiptCancelResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          properties:
            id: { type: string }
            code: { type: string }
            status: { type: string, description: CANCELLED }

    VersionOnlyRequest:
      type: object
      required: [version]
      properties:
        version: { type: integer, minimum: 1, description: 乐观锁版本号（CAS 原子条件） }

    InspectionMode:
      type: string
      enum: [SKIP, SPOT, FULL]
      description: SKIP=免检（complete 服务端强制 QUALIFIED）；SPOT/FULL=必提交数量

    InspectionResult:
      type: string
      enum: [PENDING, QUALIFIED, PARTIAL, REJECTED]
      description: result 服务端推导，客户端不得传；PENDING 未定稿无入库资格

    InspectionCreate:
      type: object
      required: [purchaseReceiptLineId, inspectionMode]
      description: 创建质检记录（result=PENDING；来源必须已 RECEIVED 收货行；一次检验即最终结果）
      properties:
        purchaseReceiptLineId: { type: string, minLength: 1 }
        inspectionMode: { $ref: "#/components/schemas/InspectionMode" }
        remark: { type: [string, "null"], maxLength: 500 }

    InspectionUpdate:
      type: object
      required: [version]
      description: 仅 PENDING；只允许改 inspectionMode/remark（数量在 complete 时定稿）
      properties:
        version: { type: integer, minimum: 1 }
        inspectionMode: { $ref: "#/components/schemas/InspectionMode" }
        remark: { type: [string, "null"], maxLength: 500 }

    InspectionComplete:
      type: object
      required: [version]
      description: 完成 Gate（SPOT/FULL 必提交数量；SKIP 服务端强制，数量忽略）
      properties:
        version: { type: integer, minimum: 1 }
        qualifiedQty: { type: number, format: decimal, description: 合格数量（≥0；SKIP 忽略） }
        rejectedQty: { type: number, format: decimal, description: 拒收数量（≥0；→ PurchaseReturn INSPECTION 来源） }

    Inspection:
      type: object
      properties:
        id: { type: string }
        purchaseReceiptLineId: { type: string, description: 唯一（一个收货行只有一个最终 Inspection） }
        inspectionMode: { $ref: "#/components/schemas/InspectionMode" }
        result: { $ref: "#/components/schemas/InspectionResult" }
        qualifiedQty: { type: number, format: decimal }
        rejectedQty: { type: number, format: decimal }
        inspectedById: { type: [string, "null"] }
        inspectedAt: { type: [string, "null"], format: date-time }
        version: { type: integer }

    InspectionResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data: { $ref: "#/components/schemas/Inspection" }

    InspectionListResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          properties:
            total: { type: integer }
            page: { type: integer }
            pageSize: { type: integer }
            items:
              type: array
              items: { $ref: "#/components/schemas/Inspection" }

    InspectionCompleteResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, result, qualifiedQty, rejectedQty]
          properties:
            id: { type: string }
            result: { $ref: "#/components/schemas/InspectionResult" }
            qualifiedQty: { type: number, format: decimal }
            rejectedQty: { type: number, format: decimal }

    WarehouseReceiptStatus:
      type: string
      enum: [DRAFT, POSTED, CANCELLED]
      description: D10：Created ≠ Posted——只有 POSTED 才触发 6A InventoryMovement(IN)

    WarehouseReceiptLineCreate:
      type: object
      required: [purchaseReceiptLineId, inspectionId, quantity]
      description: 入库行（消费已完成且 qualifiedQty>0 的 Inspection；组合 FK 同属；P6 批次/序列号/效期采集）
      properties:
        purchaseReceiptLineId: { type: string, description: 溯源收货行 }
        inspectionId: { type: string, description: 质量结论（已完成且 qualifiedQty > 0） }
        quantity: { type: number, format: decimal, description: 入库数量（> 0；≤ 可入库余额 qualifiedQty - 已占用） }
        batchNo: { type: [string, "null"], maxLength: 100 }
        serialNos: { type: [array, "null"], items: { type: string, maxLength: 100 } }
        mfgDate: { type: [string, "null"], maxLength: 50, description: 生产日期（ISO 日期字符串） }
        expDate: { type: [string, "null"], maxLength: 50, description: 有效期至（ISO 日期字符串） }
        remark: { type: [string, "null"], maxLength: 500 }

    WarehouseReceiptCreate:
      type: object
      required: [purchaseReceiptId, warehouseId, lines]
      description: 创建入库单（DRAFT；来源收货单必须已 RECEIVED；DIRECT_PROJECT 禁入库 P4）
      properties:
        purchaseReceiptId: { type: string, minLength: 1 }
        warehouseId: { type: string, minLength: 1 }
        locationId: { type: string, description: 库位（若提供必须属于同一 warehouse） }
        remark: { type: [string, "null"], maxLength: 500 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/WarehouseReceiptLineCreate" }

    WarehouseReceiptUpdate:
      type: object
      required: [version]
      description: 仅 DRAFT；行整体替换；warehouseId 必填不可清空、locationId 可空（组合 FK 同属）
      properties:
        version: { type: integer, minimum: 1 }
        warehouseId: { type: string }
        locationId: { type: [string, "null"] }
        remark: { type: [string, "null"], maxLength: 500 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/WarehouseReceiptLineCreate" }

    WarehouseReceiptPost:
      type: object
      required: [version]
      description: 过账 Gate（DRAFT → POSTED；version 乐观锁 + 幂等 ALREADY_POSTED；只有 POSTED 触发 6A IN）
      properties:
        version: { type: integer, minimum: 1 }

    WarehouseReceipt:
      type: object
      properties:
        id: { type: string }
        code: { type: string }
        purchaseReceiptId: { type: string }
        warehouseId: { type: string }
        locationId: { type: [string, "null"] }
        status: { $ref: "#/components/schemas/WarehouseReceiptStatus" }
        postedAt: { type: [string, "null"], format: date-time }
        postedById: { type: [string, "null"] }
        version: { type: integer }
        lines:
          type: array
          items: { type: object }

    WarehouseReceiptResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data: { $ref: "#/components/schemas/WarehouseReceipt" }

    WarehouseReceiptListResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          properties:
            total: { type: integer }
            page: { type: integer }
            pageSize: { type: integer }
            items:
              type: array
              items: { $ref: "#/components/schemas/WarehouseReceipt" }

    WarehouseReceiptPostResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, code, status, postedAt]
          properties:
            id: { type: string }
            code: { type: string }
            status: { type: string, description: POSTED }
            postedAt: { type: string, format: date-time }

    PurchaseReturnStatus:
      type: string
      enum: [DRAFT, RETURNED, CANCELLED]
      description: 退货事实生命周期：DRAFT → RETURNED（Return Gate 落定）→ CANCELLED（仅 DRAFT）

    PurchaseReturnType:
      type: string
      enum: [REJECTED_ON_RECEIPT, RETURN_AFTER_STOCK_IN, QUALITY_ISSUE]

    PurchaseReturnDisposition:
      type: string
      enum: [REPLACE_REQUIRED, CREDIT_ONLY]
      description: |
        line-level 处置（必填）：REPLACE_REQUIRED = 供应商仍欠货 → Return Gate 同一事务内真正 reopen PO 履约
        （INSPECTION/WAREHOUSE 来源 receivedQty-=qty + remainingReceiveQty 重开；RECEIPT_LINE 不重复 reopen）；
        CREDIT_ONLY = 采购数量最终减少/财务冲减（不自动重开待交）。

    PurchaseReturnLineCreate:
      type: object
      required: [sourceRefType, quantity, disposition, returnReason]
      description: 退货行（三来源 exactly-one FK；API 强制 sourceRefType 与 FK 匹配）
      properties:
        sourceRefType:
          type: string
          enum: [RECEIPT_LINE, WAREHOUSE_RECEIPT_LINE, INSPECTION]
        sourcePurchaseReceiptLineId: { type: string, description: RECEIPT_LINE 必填（可退上限 = rejectedOnReceiptQty） }
        sourceWarehouseReceiptLineId: { type: string, description: WAREHOUSE_RECEIPT_LINE 必填（可退上限 = POSTED 入库行 quantity） }
        sourceInspectionId: { type: string, description: INSPECTION 必填（可退上限 = rejectedQty；result ≠ PENDING） }
        quantity: { type: number, format: decimal, description: 退货数量（> 0；≤ 来源可退余额，Return Gate 锁内重算累计 RETURNED） }
        disposition: { $ref: "#/components/schemas/PurchaseReturnDisposition" }
        returnReason: { type: string, minLength: 1, maxLength: 500 }
        batchNo: { type: [string, "null"], maxLength: 100, description: 已入库退货批次追溯 }
        serialNos: { type: [array, "null"], items: { type: string, maxLength: 100 } }
        remark: { type: [string, "null"], maxLength: 500 }

    PurchaseReturnCreate:
      type: object
      required: [purchaseOrderId, returnType, lines]
      description: 创建退货单（DRAFT；来源必须属于该 PO；创建即取号 PRT-）
      properties:
        purchaseOrderId: { type: string, minLength: 1 }
        returnType: { $ref: "#/components/schemas/PurchaseReturnType" }
        remark: { type: [string, "null"], maxLength: 500 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PurchaseReturnLineCreate" }

    PurchaseReturnUpdate:
      type: object
      required: [version]
      description: 仅 DRAFT；行整体替换并重新校验
      properties:
        version: { type: integer, minimum: 1 }
        returnType: { $ref: "#/components/schemas/PurchaseReturnType" }
        remark: { type: [string, "null"], maxLength: 500 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PurchaseReturnLineCreate" }

    PurchaseReturnReturn:
      type: object
      required: [version]
      description: 退货 Gate（DRAFT → RETURNED；version 乐观锁 + 幂等 ALREADY_RETURNED；锁内重算累计 RETURNED 防并发超退）
      properties:
        version: { type: integer, minimum: 1 }

    PurchaseReturn:
      type: object
      properties:
        id: { type: string }
        code: { type: string, description: PRT- 前缀取号 }
        purchaseOrderId: { type: string }
        supplierId: { type: string }
        returnType: { $ref: "#/components/schemas/PurchaseReturnType" }
        status: { $ref: "#/components/schemas/PurchaseReturnStatus" }
        returnedAt: { type: [string, "null"], format: date-time }
        returnedById: { type: [string, "null"] }
        version: { type: integer }
        lines:
          type: array
          items: { type: object }

    PurchaseReturnResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data: { $ref: "#/components/schemas/PurchaseReturn" }

    PurchaseReturnListResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          properties:
            total: { type: integer }
            page: { type: integer }
            pageSize: { type: integer }
            items:
              type: array
              items: { $ref: "#/components/schemas/PurchaseReturn" }

    PurchaseReturnReturnResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, code, status, returnedAt]
          properties:
            id: { type: string }
            code: { type: string }
            status: { type: string, description: RETURNED }
            returnedAt: { type: string, format: date-time }
"""

# ============================================================================
# Apply insertions
# ============================================================================

# 1. Tags: after "- name: Purchase Orders\n"
anchor_tags = "  - name: Purchase Orders\n"
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
