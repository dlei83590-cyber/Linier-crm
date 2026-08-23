#!/usr/bin/env python3
"""Generate Sprint 5A Purchase OpenAPI blocks (tags + paths + schemas) and insert into docs/openapi.yaml."""
import sys

SRC = "docs/openapi.yaml"
content = open(SRC, encoding="utf-8").read()

# ============================================================================
# 1. TAGS block (insert after "- name: Credit Debit Notes")
# ============================================================================
TAGS = """  - name: Purchase Requisitions
  - name: Purchase Orders
"""

# ============================================================================
# 2. PATHS block (insert before "\ncomponents:")
# ============================================================================
PATHS = r"""  # ==========================================================================
  # Sprint 5A — Purchase Requisition（PR = 采购需求事实源，无金额字段）
  # ==========================================================================
  /api/purchase-requisitions:
    get:
      tags: [Purchase Requisitions]
      summary: List purchase requisitions (paginated, filterable by code/status/requesterId/departmentId/dateFrom/dateTo)
      description: |
        PR = 采购需求事实源（无金额字段）。列表过滤：code（模糊 insensitive）/ status / requesterId / departmentId / createdAt 区间。
        软删除已过滤；每项含 requester/department 摘要与 lines 计数。
      operationId: listPurchaseRequisitions
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
          schema: { type: string, description: 申请单号模糊查询（insensitive） }
        - name: status
          in: query
          schema: { type: string, description: PurchaseRequisitionStatus 存储态 }
        - name: requesterId
          in: query
          schema: { type: string }
        - name: departmentId
          in: query
          schema: { type: string }
        - name: dateFrom
          in: query
          schema: { type: string, format: date, description: createdAt >= dateFrom }
        - name: dateTo
          in: query
          schema: { type: string, format: date, description: createdAt <= dateTo }
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
    post:
      tags: [Purchase Requisitions]
      summary: Create purchase requisition (DRAFT; no amount facts; atomic PR-2026-xxxx code)
      description: |
        创建 PR（DRAFT）。红线：**PR = 需求事实源，Header/Line 不得出现金额/单价/税额等采购承诺事实**；
        创建即从 DocumentSequence(PURCHASE_REQUISITION) 原子取号（PR-2026-xxxx）；Line quantity 必须 > 0（服务端 Decimal 精确校验）；
        Item/UOM 引用在服务端验证；创建不触发审批、不创建 PO。
      operationId: createPurchaseRequisition
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseRequisitionCreate"
      responses:
        "201":
          description: Created（status=DRAFT + code）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          description: Conflict（quantity 非法 / Item/UOM 引用无效）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-requisitions/{id}:
    get:
      tags: [Purchase Requisitions]
      summary: Get purchase requisition detail
      description: |
        详情含 requester / department / workflowInstance（审批投影）/ lines（item + uom）/ 最新 revision。
      operationId: getPurchaseRequisition
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      tags: [Purchase Requisitions]
      summary: Update purchase requisition (DRAFT only; optimistic lock; Revision before change)
      description: |
        仅 DRAFT 可修改；修改必须产生 Revision（变更前快照）；禁止修改 code/status/requesterId/departmentId/金额字段（PR 无金额事实）；
        Line 不作为独立业务入口 → 行变更经 PATCH 整体替换（服务端验证 Item/UOM + quantity>0）；
        不触发重新审批（PR 无金额，无财务字段可触发重审）、不创建 PO。
        乐观锁：updateMany where {id, version, status:'DRAFT'} count===1，失败 409 VERSION_CONFLICT（CTO Phase 3 Blocking ① 修复）。
      operationId: updatePurchaseRequisition
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseRequisitionUpdate"
      responses:
        "200":
          description: OK（updated + 新 Revision）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（仅 DRAFT 可更新 / 版本冲突 / Item/UOM 引用无效 / quantity 非法）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-requisitions/{id}/submit:
    post:
      tags: [Purchase Requisitions]
      summary: Submit purchase requisition for approval (DRAFT → SUBMITTED; conditional workflow)
      description: |
        DRAFT → SUBMITTED。匹配 ApprovalPolicy(module=PURCHASE_REQUISITION)：
        - **命中策略** → 创建/复用 Workflow 实例（单实例多轮重提：REJECTED 后复用同一实例重新 SUBMIT——失效旧 Approver /
          instance→RUNNING / currentStep 重置首步 / 新建 PENDING Approver / PR→SUBMITTED / approvalStatus=PENDING /
          清 approvedAt/approvedById / 新一轮 SUBMIT Action+History 留痕），approvalStatus=PENDING；
        - **未命中策略** → 保持 SUBMITTED。
        **审批不创建 PO**（PR 是需求事实源）；RUNNING 实例重复提交 → 409 WORKFLOW_INSTANCE_EXISTS。
      operationId: submitPurchaseRequisition
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK（status=SUBMITTED + workflowInstanceId）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionSubmitResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（仅 DRAFT 可提交 / 无行 / 策略未命中 / RUNNING 重复提交）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-requisitions/{id}/convert:
    post:
      tags: [Purchase Requisitions]
      summary: Convert approved PR to Purchase Order (REQUISITION source; row-level traceability)
      description: |
        PR status=APPROVED → 创建 PO（sourceType=REQUISITION + requisitionId 溯源）。事务内 SELECT...FOR UPDATE 真实行锁；
        校验 PR=APPROVED 且未转换（status!=CONVERTED + 无已存在 PO）+ lines>0；Supplier 有效；原子取号（PO-2026-xxxx）；
        快照复制 PR Line（**保留 sourcePurchaseRequisitionLineId 行级溯源**；价格双通道：SUPPLIER_PRICE_SNAPSHOT 服务端解析 /
        MANUAL 用 override+priceReason）；金额服务端 Decimal 聚合；PO Revision+Snapshot(CREATED)；回写 PR status=CONVERTED。
        并发 Convert → P2002 → 409 REQUISITION_ALREADY_CONVERTED。
        权限：purchase-requisition:approve（对齐 quotation.convert 先例）。
      operationId: convertPurchaseRequisitionToPurchaseOrder
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseOrderConvert"
      responses:
        "200":
          description: OK（新 PO：status=DRAFT + code + requisitionId）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionConvertResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（PR 未审批 / 已转换 / Supplier 无效 / 价格缺失 / Item 缺失）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-requisitions/{id}/price-suggestions:
    get:
      tags: [Purchase Requisitions]
      summary: Price channel suggestions for PR to PO convert (server-authoritative supplier price snapshot resolution)
      description: |
        PR → PO 转单价格通道建议（修复无供应商价格快照时 409 死胡同——前端据此引导 MANUAL 通道录入）。
        服务端权威解析（与 convert / PO PATCH 完全同语义，复用 resolveSupplierPriceSnapshot）：
        partnerId=supplier.partnerId + itemId + priceSource=SUPPLIER + isActive + deletedAt=null，priority asc。
        命中 → snapshot={partnerPriceId, unitPrice, taxRate}（走 SUPPLIER_PRICE_SNAPSHOT）；未命中 / 行无 itemId / supplier 无 partnerId → snapshot=null（前端强制 MANUAL：unitPrice + priceReason）。
        只读、无副作用；权限：purchase-requisition:approve（与 convert 一致）。
      operationId: getPurchaseRequisitionPriceSuggestions
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
        - { name: supplierId, in: query, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK（每行价格通道建议）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseRequisitionPriceSuggestionsResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

  # ==========================================================================
  # Sprint 5A — Purchase Order（PO = 对供应商的采购承诺事实源）
  # 红线：APPROVED ≠ CONFIRMED；只有 CONFIRMED PO 才是 5B Goods Receipt 合法来源
  # ==========================================================================
  /api/purchase-orders:
    get:
      tags: [Purchase Orders]
      summary: List purchase orders (paginated, filterable by code/supplierId/status/sourceType/dateFrom/dateTo)
      description: |
        PO = 对供应商的采购承诺事实源。列表过滤：code / supplierId / status / sourceType（REQUISITION|DIRECT）/ orderDate 区间。
        软删除已过滤；每项含 supplier/requisition 摘要与 lines 计数。
      operationId: listPurchaseOrders
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
          schema: { type: string, description: 采购订单号模糊查询（insensitive） }
        - name: supplierId
          in: query
          schema: { type: string }
        - name: status
          in: query
          schema: { type: string, description: PurchaseOrderStatus 存储态 }
        - name: sourceType
          in: query
          schema: { type: string, enum: [REQUISITION, DIRECT] }
        - name: dateFrom
          in: query
          schema: { type: string, format: date, description: orderDate >= dateFrom }
        - name: dateTo
          in: query
          schema: { type: string, format: date, description: orderDate <= dateTo }
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
    post:
      tags: [Purchase Orders]
      summary: Create Direct Purchase Order (sourceType=DIRECT; price dual-channel; server-side amount aggregation)
      description: |
        创建 Direct PO（sourceType=DIRECT，requisitionId 为空）。**Direct 客户端禁止传 sourcePurchaseRequisitionLineId
        （400 SOURCE_LINE_FORBIDDEN，CTO Phase 4A Re-review 细节①）**；Direct Purchase 不能绕过 PO Approval（Submit 属 4B）。
        校验：Supplier 有效 / Item/UOM 服务端验证 / quantity>0；价格双通道：
        - SUPPLIER_PRICE_SNAPSHOT：服务端 resolveSupplierPriceSnapshot（PartnerPrice partnerId+itemId+priceSource=SUPPLIER，priority asc），未命中 → 409 PRICE_NOT_FOUND；
        - MANUAL：unitPrice + priceReason 必填（审计三件套 priceReason/priceSetById/priceSetAt）。
        行金额公式（服务端 Decimal）：lineAmount=unitPrice×quantity；taxAmount=lineAmount×taxRate/100；totalAmount=lineAmount+taxAmount；
        头金额服务端聚合（subtotal/taxAmount/totalAmount），禁客户端直传。receivedQty=0 / remainingReceiveQty=quantity 初始化（5A 禁改，5B 唯一回写方）。
        Revision+Snapshot(CREATED) 使用**实际持久化后的 lines**（CTO Phase 4A Blocking ② 修复）。
      operationId: createDirectPurchaseOrder
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseOrderCreate"
      responses:
        "201":
          description: Created（status=DRAFT + code + totalAmount）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "409":
          description: Conflict（Supplier/Item/UOM 无效 / quantity 非法 / 价格缺失 / MANUAL 缺 priceReason / Direct 传了 source 行）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-orders/{id}:
    get:
      tags: [Purchase Orders]
      summary: Get purchase order detail
      description: |
        详情含 supplier / requisition（REQUISITION 来源时）/ workflowInstance（审批投影）/ lines（item + uom +
        sourcePurchaseRequisitionLine 溯源）/ 最新 revision / 最近 5 个 snapshots。
      operationId: getPurchaseOrder
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      tags: [Purchase Orders]
      summary: Update purchase order (DRAFT only; optimistic lock; Revision before change)
      description: |
        仅 DRAFT 可修改；修改必须产生 Revision（变更前快照）；金额服务端重算；receivedQty/remainingReceiveQty 禁止客户端传入。
        乐观锁：updateMany where {id, version, status:'DRAFT'} count===1，失败 409 VERSION_CONFLICT。
        行整体替换溯源（CTO Phase 4A Blocking ③ 修复）：
        - REQUISITION：每行必须提供 sourcePurchaseRequisitionLineId（400 SOURCE_LINE_REQUIRED）+ 服务端三条件校验
          （purchaseRequisitionId==header.requisitionId + deletedAt=null + itemId 一致，否则 409 SOURCE_LINE_INVALID）；
        - DIRECT：禁止传 source（400 SOURCE_LINE_FORBIDDEN）。
      operationId: updatePurchaseOrder
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PurchaseOrderUpdate"
      responses:
        "200":
          description: OK（updated + 新 Revision）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（仅 DRAFT 可更新 / 版本冲突 / Supplier/Item/UOM 无效 / 价格缺失 / 溯源校验失败）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-orders/{id}/submit:
    post:
      tags: [Purchase Orders]
      summary: Submit purchase order for approval (DRAFT → SUBMITTED / APPROVED projection; never CONFIRMED)
      description: |
        DRAFT → SUBMITTED（事务内 FOR UPDATE 行锁）。校验：≥1 行 / qty>0 / Supplier 有效 / 来源一致性
        （REQUISITION 必须带 requisitionId；DIRECT 禁止）/ 服务端金额重算与 Header 一致。
        条件触发审批（maybeTriggerPurchaseOrderApproval，module=PURCHASE_ORDER 按 totalAmount 匹配）：
        - **命中策略** → 创建/复用 Workflow 实例（单实例多轮重提，approvalStatus=PENDING）；
        - **未命中策略（no-policy / no-rule-matched）** → 直接 status=APPROVED + approvalStatus=APPROVED 投影
          （workflowSkipped 标记；**仍非 CONFIRMED**）。
        **红线：Submit 永不自动 CONFIRMED**——审批通过只是公司内部同意采购；只有显式 POST /confirm 才形成对供应商的采购承诺。
      operationId: submitPurchaseOrder
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK（status + approvalStatus + workflowInstanceId + workflowSkipped + resubmitted）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderSubmitResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（仅 DRAFT 可提交 / 无行 / qty 非法 / Supplier 无效 / 金额不一致 / 策略未命中）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-orders/{id}/confirm:
    post:
      tags: [Purchase Orders]
      summary: Confirm purchase order (APPROVED → CONFIRMED; formal commitment to supplier; sole 5B GR source)
      description: |
        **关键商业动作**。事务内 `SELECT ... FOR UPDATE` 行锁 → 校验 status=APPROVED + approvalStatus=APPROVED
        （approval gate）→ Supplier 有效 → Lines 非空 + qty>0 → 金额一致性（服务端重算与 Header 一致）→
        status=CONFIRMED + confirmedAt/confirmedById → **CONFIRMED Snapshot**（唯一约束 [purchaseOrderId, snapshotType, revisionNo]，
        Migration 0022 多轮语义）→ Revision（变更留痕）→ PurchaseOrderConfirmed 事件 + Audit。
        **并发幂等（CTO Phase 4B Verification V2）**：两个并发 Confirm 在事务行锁下串行化——第一个成功置 CONFIRMED，
        第二个等锁后读到 status=CONFIRMED → 稳定 **409 PURCHASE_ORDER_INVALID_STATE**（不会产生第二个 CONFIRMED
        Revision/Snapshot/Event）。
        **红线：APPROVED ≠ CONFIRMED**。审批通过 = 公司内部同意采购；Confirm = 正式形成对供应商的采购承诺。
        **只有 CONFIRMED PO 才是 Sprint 5B Goods Receipt 唯一合法来源**（5A 只定义门禁，不实现 GR）。
      operationId: confirmPurchaseOrder
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK（status=CONFIRMED + confirmedAt）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderConfirmResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（仅 APPROVED 可确认 / 审批未通过 / Supplier 无效 / 无行 / qty 非法 / 金额不一致）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /api/purchase-orders/{id}/cancel:
    post:
      tags: [Purchase Orders]
      summary: Cancel purchase order (DRAFT/APPROVED cancellable; CONFIRMED+ forbidden)
      description: |
        事务内 FOR UPDATE 行锁 → 状态门禁（CTO Phase 4B Cancel 规则）：
        - **DRAFT / APPROVED**：允许取消 → status=CANCELLED + CANCELLED Snapshot + Revision + PurchaseOrderCancelled 事件；
        - **SUBMITTED**：409（先 Withdraw Workflow → DRAFT，再 Cancel；不开放直接取消）；
        - **CONFIRMED / PARTIALLY_RECEIVED / RECEIVED**：**409 PURCHASE_ORDER_CANCEL_FORBIDDEN**（已形成外部采购承诺，
          后续应走 Close / Purchase Amendment / Supplier communication）；
        - 已 CANCELLED → 409。
        权限：purchase-order:close（对齐 quotation.cancel 先例）。
      operationId: cancelPurchaseOrder
      security:
        - bearerAuth: []
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK（status=CANCELLED）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PurchaseOrderCancelResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Conflict（SUBMITTED 需先 Withdraw / CONFIRMED+ 禁止 / 已取消）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

"""

# ============================================================================
# 3. SCHEMAS block (append at end of file)
# ============================================================================
SCHEMAS = r"""
    # --------------------------------------------------------------------------
    # Sprint 5A — Purchase Requisition & Purchase Order（PR=需求事实源无金额 / PO=承诺事实源）
    # 红线：APPROVED ≠ CONFIRMED；只有 CONFIRMED PO 才是 5B Goods Receipt 合法来源
    # --------------------------------------------------------------------------
    PurchaseRequisitionStatus:
      type: string
      enum: [DRAFT, SUBMITTED, APPROVED, CONVERTED, CANCELLED]
      description: PR 生命周期（PR=需求事实源；CONVERTED 表示已转 PO）

    PurchaseOrderStatus:
      type: string
      enum: [DRAFT, SUBMITTED, APPROVED, CONFIRMED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED]
      description: |
        PO 生命周期：DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED；DRAFT → CANCELLED。
        **APPROVED ≠ CONFIRMED**：审批通过 = 公司内部同意采购；Confirm = 正式形成对供应商的采购承诺。
        只有 CONFIRMED PO 才能成为 5B Goods Receipt 来源。

    PurchaseOrderSourceType:
      type: string
      enum: [REQUISITION, DIRECT]
      description: |
        PO 来源链：REQUISITION = 经 PR Convert（行级溯源 sourcePurchaseRequisitionLineId）；DIRECT = 直接采购
        （显式可审计、不能绕过 PO Approval；禁止传 source 行）。

    PurchaseOrderPriceSource:
      type: string
      enum: [SUPPLIER_PRICE_SNAPSHOT, MANUAL]
      description: |
        价格双通道：SUPPLIER_PRICE_SNAPSHOT（PartnerPrice 服务端解析，priority asc）；MANUAL（授权手工价，
        必须记录 priceReason + priceSetById + priceSetAt 审计三件套）。

    PurchaseOrderSnapshotType:
      type: string
      enum: [CREATED, SUBMITTED, APPROVED, CONFIRMED, RECEIVED, CANCELLED]
      description: |
        PO 快照类型。唯一约束 [purchaseOrderId, snapshotType, revisionNo]（Migration 0022）：
        多轮审批时同一 snapshotType 可并存多份（revisionNo 区分），解决多轮重审快照冲突。

    PurchaseRequisitionLine:
      type: object
      required: [id, purchaseRequisitionId, itemId, quantity]
      properties:
        id: { type: string }
        purchaseRequisitionId: { type: string }
        lineNo: { type: integer }
        itemId: { type: string }
        description: { type: string }
        quantity: { type: number, description: 需求数量（Decimal，>0；PR 无金额事实） }
        uomId: { type: [string, "null"] }
        needDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"] }
        createdById: { type: [string, "null"] }
        updatedById: { type: [string, "null"] }
        deletedAt: { type: [string, "null"], format: date-time }
        isActive: { type: boolean }

    PurchaseRequisition:
      type: object
      required: [id, code, status, version]
      properties:
        id: { type: string }
        code: { type: string, description: 单据编号（DocumentSequence，前缀 PR，位数 6） }
        requesterId: { type: [string, "null"] }
        departmentId: { type: [string, "null"] }
        status: { $ref: "#/components/schemas/PurchaseRequisitionStatus" }
        needDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"] }
        workflowInstanceId: { type: [string, "null"], description: 审批实例投影（Workflow 为唯一审批事实源，ADR-0017） }
        approvalStatus: { type: [string, "null"] }
        approvedAt: { type: [string, "null"], format: date-time }
        approvedById: { type: [string, "null"] }
        version: { type: integer, description: 乐观锁版本 }
        createdById: { type: [string, "null"] }
        updatedById: { type: [string, "null"] }
        deletedAt: { type: [string, "null"], format: date-time }
        isActive: { type: boolean }

    PurchaseRequisitionLineCreate:
      type: object
      required: [itemId, quantity]
      properties:
        itemId: { type: string, minLength: 1 }
        description: { type: string, maxLength: 500 }
        quantity: { type: number, exclusiveMinimum: 0, description: 需求数量 > 0（服务端 Decimal 精确校验） }
        uomId: { type: string }
        lineNo: { type: integer }
        needDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"], maxLength: 500 }

    PurchaseRequisitionCreate:
      type: object
      required: [lines]
      properties:
        requesterId: { type: [string, "null"] }
        departmentId: { type: [string, "null"] }
        needDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"], maxLength: 1000 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PurchaseRequisitionLineCreate" }

    PurchaseRequisitionUpdate:
      type: object
      required: [version]
      properties:
        needDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"], maxLength: 1000 }
        lines:
          type: array
          items: { $ref: "#/components/schemas/PurchaseRequisitionLineCreate" }
        changeReason: { type: string, maxLength: 500 }
        version: { type: integer, description: 乐观锁版本（冲突返回 409 VERSION_CONFLICT） }

    PurchaseRequisitionResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data: { $ref: "#/components/schemas/PurchaseRequisition" }

    PurchaseRequisitionListResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: array
          items: { $ref: "#/components/schemas/PurchaseRequisition" }

    PurchaseRequisitionSubmitResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, status, workflowInstanceId]
          properties:
            id: { type: string }
            status: { type: string, enum: [SUBMITTED] }
            workflowInstanceId: { type: [string, "null"] }

    PurchaseOrderConvert:
      type: object
      required: [supplierId]
      description: PR → PO Convert 请求（REQUISITION 来源；行价格覆盖可选）
      properties:
        supplierId: { type: string, minLength: 1 }
        purchaserId: { type: [string, "null"], description: 采购员（CTO Phase 4B：PO Header 落地） }
        departmentId: { type: [string, "null"], description: 采购部门 }
        currency: { type: string, maxLength: 10 }
        paymentTerm: { type: [string, "null"], maxLength: 100 }
        expectedDeliveryDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"], maxLength: 1000 }
        lines:
          type: array
          items:
            type: object
            properties:
              priceSource: { $ref: "#/components/schemas/PurchaseOrderPriceSource" }
              unitPrice: { type: number, description: MANUAL 通道必填 }
              priceReason: { type: string, maxLength: 500, description: MANUAL 通道必填（审计） }
              taxRate: { type: number, description: 税率快照覆盖（默认服务端解析） }

    PurchaseRequisitionConvertResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, code, status, requisitionId]
          properties:
            id: { type: string, description: 新 PO id }
            code: { type: string, description: 新 PO 编号 }
            status: { type: string, enum: [DRAFT] }
            requisitionId: { type: string, description: 来源 PR id }

    PurchaseRequisitionPriceSuggestionsResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [supplierId, lines]
          properties:
            supplierId: { type: string, description: 目标供应商 id }
            lines:
              type: array
              description: 按 PR Line lineNo 升序（前端按序回传 convert lines override）
              items:
                type: object
                required: [lineId, lineNo, description, quantity, snapshot]
                properties:
                  lineId: { type: string, description: PR Line id }
                  lineNo: { type: integer }
                  itemId: { type: [string, "null"] }
                  itemCode: { type: [string, "null"] }
                  itemName: { type: [string, "null"] }
                  description: { type: string }
                  quantity: { type: string, description: Decimal 字符串（避免精度丢失） }
                  uomSymbol: { type: [string, "null"] }
                  snapshot:
                    type: [object, "null"]
                    description: 供应商价格快照解析结果；null=未配置（前端强制 MANUAL 通道）
                    properties:
                      partnerPriceId: { type: string }
                      unitPrice: { type: string, description: Decimal 字符串 }
                      taxRate: { type: string, description: Decimal 字符串（税档 rate，无税档=0） }

    PurchaseOrderLine:
      type: object
      required: [id, purchaseOrderId, itemId, quantity, priceSource, unitPrice]
      properties:
        id: { type: string }
        purchaseOrderId: { type: string }
        sourcePurchaseRequisitionLineId: { type: [string, "null"], description: PR Line 行级溯源（REQUISITION；永不清除） }
        lineNo: { type: integer }
        itemId: { type: string }
        description: { type: string }
        quantity: { type: number }
        uomId: { type: [string, "null"] }
        priceSource: { $ref: "#/components/schemas/PurchaseOrderPriceSource" }
        unitPrice: { type: number }
        taxRate: { type: number }
        lineAmount: { type: number, description: unitPrice×quantity（服务端 Decimal） }
        taxAmount: { type: number, description: lineAmount×taxRate/100 }
        totalAmount: { type: number, description: lineAmount+taxAmount }
        priceReason: { type: [string, "null"], description: MANUAL 审计（priceReason/priceSetById/priceSetAt） }
        priceSetById: { type: [string, "null"] }
        priceSetAt: { type: [string, "null"], format: date-time }
        receivedQty: { type: number, description: 已收数量（5A 初始 0，禁客户端改；5B 唯一回写方） }
        remainingReceiveQty: { type: number, description: 剩余可收数量（5A 初始=quantity，禁客户端改） }
        createdById: { type: [string, "null"] }
        updatedById: { type: [string, "null"] }
        deletedAt: { type: [string, "null"], format: date-time }
        isActive: { type: boolean }

    PurchaseOrder:
      type: object
      required: [id, code, sourceType, supplierId, status, currency, totalAmount, version]
      properties:
        id: { type: string }
        code: { type: string, description: 单据编号（DocumentSequence，前缀 PO，位数 6） }
        sourceType: { $ref: "#/components/schemas/PurchaseOrderSourceType" }
        supplierId: { type: string }
        requisitionId: { type: [string, "null"], description: REQUISITION 来源时必填；DIRECT 为空 }
        purchaserId: { type: [string, "null"], description: 采购员（CTO Phase 4B；Direct PO 无 PR 可溯） }
        departmentId: { type: [string, "null"], description: 采购部门 }
        status: { $ref: "#/components/schemas/PurchaseOrderStatus" }
        orderDate: { type: [string, "null"], format: date-time }
        expectedDeliveryDate: { type: [string, "null"], format: date-time }
        paymentTerm: { type: [string, "null"] }
        currency: { type: string, example: CNY }
        remark: { type: [string, "null"] }
        subtotal: { type: number, description: 服务端聚合 }
        taxAmount: { type: number, description: 服务端聚合 }
        totalAmount: { type: number, description: 服务端聚合（禁客户端直传头金额） }
        workflowInstanceId: { type: [string, "null"], description: 审批实例投影（Workflow 为唯一审批事实源，ADR-0017） }
        approvalStatus: { type: [string, "null"] }
        approvedAt: { type: [string, "null"], format: date-time }
        approvedById: { type: [string, "null"] }
        confirmedAt: { type: [string, "null"], format: date-time, description: 正式下单时间（Confirm 动作） }
        confirmedById: { type: [string, "null"] }
        version: { type: integer, description: 乐观锁版本 }
        createdById: { type: [string, "null"] }
        updatedById: { type: [string, "null"] }
        deletedAt: { type: [string, "null"], format: date-time }
        isActive: { type: boolean }

    PurchaseOrderLineCreate:
      type: object
      required: [itemId, quantity]
      properties:
        itemId: { type: string, minLength: 1 }
        description: { type: string, maxLength: 500 }
        quantity: { type: number, exclusiveMinimum: 0 }
        uomId: { type: string }
        lineNo: { type: integer }
        sourcePurchaseRequisitionLineId: { type: string, description: REQUISITION 每行必填（服务端三条件校验）；DIRECT 禁止 }
        priceSource: { $ref: "#/components/schemas/PurchaseOrderPriceSource" }
        unitPrice: { type: number, description: MANUAL 通道必填（>0） }
        priceReason: { type: string, maxLength: 500, description: MANUAL 通道必填（审计） }
        taxRate: { type: number, description: 税率快照（SUPPLIER_PRICE_SNAPSHOT 时服务端从税档解析；MANUAL 可传，默认 0） }

    PurchaseOrderCreate:
      type: object
      required: [supplierId, lines]
      description: Direct Purchase 创建（sourceType=DIRECT）
      properties:
        supplierId: { type: string, minLength: 1 }
        purchaserId: { type: [string, "null"], description: 采购员（CTO Phase 4B） }
        departmentId: { type: [string, "null"], description: 采购部门 }
        currency: { type: string, maxLength: 10 }
        paymentTerm: { type: [string, "null"], maxLength: 100 }
        expectedDeliveryDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"], maxLength: 1000 }
        lines:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PurchaseOrderLineCreate" }

    PurchaseOrderUpdate:
      type: object
      required: [version]
      description: 仅 DRAFT；金额服务端重算；receivedQty/remainingReceiveQty 禁止客户端传入
      properties:
        purchaserId: { type: [string, "null"] }
        departmentId: { type: [string, "null"] }
        paymentTerm: { type: [string, "null"], maxLength: 100 }
        expectedDeliveryDate: { type: [string, "null"], format: date-time }
        remark: { type: [string, "null"], maxLength: 1000 }
        lines:
          type: array
          items: { $ref: "#/components/schemas/PurchaseOrderLineCreate" }
        changeReason: { type: string, maxLength: 500 }
        version: { type: integer, description: 乐观锁版本（冲突返回 409 VERSION_CONFLICT） }

    PurchaseOrderResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data: { $ref: "#/components/schemas/PurchaseOrder" }

    PurchaseOrderListResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: array
          items: { $ref: "#/components/schemas/PurchaseOrder" }

    PurchaseOrderSubmitResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, status, approvalStatus]
          properties:
            id: { type: string }
            status: { type: string, description: SUBMITTED（命中策略）或 APPROVED（无策略直接投影） }
            approvalStatus: { type: [string, "null"] }
            workflowInstanceId: { type: [string, "null"] }
            workflowSkipped: { type: [string, "null"], description: "no-policy | no-rule-matched | null" }
            resubmitted: { type: boolean, description: 是否复用终态实例重提 }

    PurchaseOrderConfirmResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, status, confirmedAt]
          properties:
            id: { type: string }
            status: { type: string, enum: [CONFIRMED] }
            confirmedAt: { type: [string, "null"], format: date-time }

    PurchaseOrderCancelResponse:
      type: object
      required: [success, data]
      properties:
        success: { type: boolean, example: true }
        data:
          type: object
          required: [id, status]
          properties:
            id: { type: string }
            status: { type: string, enum: [CANCELLED] }

    PurchaseRequisitionErrorCodes:
      type: string
      description: |
        Purchase Requisition 领域错误码（与实现 errors.ts 一致）：
        - PURCHASE_REQUISITION_NOT_FOUND（404）申请不存在
        - PURCHASE_REQUISITION_INVALID_STATE（409）仅 DRAFT 可提交/更新
        - PURCHASE_REQUISITION_NO_LINES（409）至少需要一行明细
        - PURCHASE_REQUISITION_QUANTITY_INVALID（400/409）需求数量必须大于 0
        - PURCHASE_REQUISITION_ITEM_NOT_FOUND（400）无效 Item 引用
        - PURCHASE_REQUISITION_UOM_NOT_FOUND（400）无效 UOM 引用
        - PURCHASE_REQUISITION_APPROVAL_POLICY_NOT_FOUND（409）未匹配审批策略
        - PURCHASE_REQUISITION_WORKFLOW_FAILED（409）工作流定义缺失/未激活

    PurchaseOrderErrorCodes:
      type: string
      description: |
        Purchase Order 领域错误码（与实现 errors.ts 一致）：
        - PURCHASE_ORDER_NOT_FOUND（404）订单不存在
        - PURCHASE_ORDER_INVALID_STATE（409）状态不允许（含 Confirm 重复调用稳定 409；仅 APPROVED 可确认）
        - PURCHASE_ORDER_NO_LINES（409）至少需要一行明细
        - PURCHASE_ORDER_QUANTITY_INVALID（400/409）采购数量必须大于 0
        - PURCHASE_ORDER_SUPPLIER_NOT_FOUND（409）供应商无效
        - PURCHASE_ORDER_ITEM_NOT_FOUND（400）无效 Item 引用
        - PURCHASE_ORDER_UOM_NOT_FOUND（400）无效 UOM 引用
        - PURCHASE_ORDER_PRICE_NOT_FOUND（409）SUPPLIER_PRICE_SNAPSHOT 未命中
        - PURCHASE_ORDER_PRICE_REASON_REQUIRED（400）MANUAL 缺 priceReason
        - PURCHASE_ORDER_REQUISITION_NOT_APPROVED（409）PR 未审批不可 Convert
        - PURCHASE_ORDER_REQUISITION_ALREADY_CONVERTED（409）PR 已转换
        - PURCHASE_ORDER_SOURCE_LINE_REQUIRED（400）REQUISITION 每行必填 sourcePurchaseRequisitionLineId
        - PURCHASE_ORDER_SOURCE_LINE_INVALID（409）溯源行三条件校验失败（属 header.requisitionId / 未删除 / itemId 一致）
        - PURCHASE_ORDER_SOURCE_LINE_FORBIDDEN（400）DIRECT 禁止传 source 行
        - PURCHASE_ORDER_APPROVAL_POLICY_NOT_FOUND（409）未匹配审批策略
        - PURCHASE_ORDER_NOT_APPROVED（409）Confirm 前置：仅 APPROVED 可 Confirm
        - PURCHASE_ORDER_ALREADY_CONFIRMED（409）重复 Confirm（幂等稳定 409）
        - PURCHASE_ORDER_APPROVAL_REQUIRED（409）命中审批策略但未 APPROVED，禁止 Confirm（APPROVED ≠ CONFIRMED）
        - PURCHASE_ORDER_CANCEL_FORBIDDEN（409）CONFIRMED+ 禁止 Cancel（已形成外部采购承诺）
        - PURCHASE_ORDER_WORKFLOW_FAILED（409）命中策略但工作流定义缺失/未激活
"""

# ============================================================================
# Apply insertions
# ============================================================================

# 1. Tags: after "- name: Credit Debit Notes\n"
anchor_tags = "  - name: Credit Debit Notes\n"
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
