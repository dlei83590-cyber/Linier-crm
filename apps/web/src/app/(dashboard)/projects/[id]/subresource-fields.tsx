"use client";

/**
 * Project Subresource Form Fields（F2-4B2-1A，CTO #12350/#12368）
 *
 * 资源专属表单字段，作为 children 传入共享 ProjectSubresourceDialog。
 * 共享 Dialog 只做交互框架（open/title/mode/saving/error/CAS stale/onReload/Cancel/Save），
 * 不感知任何资源字段；本文件负责 B2-1A 四类子资源的字段语义：Stakeholders / Members / Milestones / Tasks。
 * Members：UI 不暴露 userId（无正式 user selector，CTO 锁死）——Create/Edit 只管理
 * name / roleInProject / joinedAt / leftAt；Edit PATCH 不发送 userId 即保留旧值。
 * 日期语义：type="date"，提交 "" → null，否则 new Date(`${value}T00:00:00.000Z`).toISOString()；
 * 回填 stored ? stored.slice(0, 10) : ""。
 */

export interface StakeholderFormValue {
  role: string;
  name: string;
  title: string;
  department: string;
  phone: string;
  email: string;
  note: string;
}

export const EMPTY_STAKEHOLDER_FORM: StakeholderFormValue = {
  role: "REQUESTER",
  name: "",
  title: "",
  department: "",
  phone: "",
  email: "",
  note: "",
};

export function StakeholderFields({
  value,
  onChange,
  roleLabels,
}: {
  value: StakeholderFormValue;
  onChange: (v: StakeholderFormValue) => void;
  roleLabels: Record<string, string>;
}) {
  const set = (patch: Partial<StakeholderFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">角色 *</label>
        <select
          value={value.role}
          onChange={(e) => set({ role: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {Object.entries(roleLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">姓名 *</label>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">职务</label>
        <input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">部门</label>
        <input
          value={value.department}
          onChange={(e) => set({ department: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">电话</label>
        <input
          value={value.phone}
          onChange={(e) => set({ phone: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">邮箱</label>
        <input
          type="email"
          value={value.email}
          onChange={(e) => set({ email: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">备注</label>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={3}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

export interface MemberFormValue {
  name: string;
  roleInProject: string;
  joinedAt: string; // yyyy-MM-dd
  leftAt: string; // yyyy-MM-dd
}

export const EMPTY_MEMBER_FORM: MemberFormValue = {
  name: "",
  roleInProject: "",
  joinedAt: "",
  leftAt: "",
};

export function MemberFields({
  value,
  onChange,
}: {
  value: MemberFormValue;
  onChange: (v: MemberFormValue) => void;
}) {
  const set = (patch: Partial<MemberFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">姓名 *</label>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">项目内角色</label>
        <input
          value={value.roleInProject}
          onChange={(e) => set({ roleInProject: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">加入时间</label>
        <input
          type="date"
          value={value.joinedAt}
          onChange={(e) => set({ joinedAt: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">离开时间</label>
        <input
          type="date"
          value={value.leftAt}
          onChange={(e) => set({ leftAt: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

export interface MilestoneFormValue {
  name: string;
  plannedDate: string; // yyyy-MM-dd
  actualDate: string; // yyyy-MM-dd
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";
  deliverable: string;
  delayReason: string;
}

export const EMPTY_MILESTONE_FORM: MilestoneFormValue = {
  name: "",
  plannedDate: "",
  actualDate: "",
  status: "PLANNED",
  deliverable: "",
  delayReason: "",
};

/**
 * Milestone 字段（B2-1A-2，CTO #12446）。
 * 日期语义同 Member：回填 slice(0,10)、提交 blank→null、有值转 ISO datetime。
 * COMPLETED 的 Domain Event 语义留在 backend：UI 只发送 status，不自动填 actualDate。
 * statusLabels 由 page.tsx 注入（MILESTONE_STATUS_LABELS），本文件不复制中文映射。
 */
export function MilestoneFields({
  value,
  onChange,
  statusLabels,
}: {
  value: MilestoneFormValue;
  onChange: (v: MilestoneFormValue) => void;
  statusLabels: Record<string, string>;
}) {
  const set = (patch: Partial<MilestoneFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">名称 *</label>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">状态</label>
        <select
          value={value.status}
          onChange={(e) => set({ status: e.target.value as MilestoneFormValue["status"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {Object.entries(statusLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">计划日期</label>
        <input
          type="date"
          value={value.plannedDate}
          onChange={(e) => set({ plannedDate: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">实际日期</label>
        <input
          type="date"
          value={value.actualDate}
          onChange={(e) => set({ actualDate: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">交付成果</label>
        <textarea
          value={value.deliverable}
          onChange={(e) => set({ deliverable: e.target.value })}
          rows={2}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">延期原因</label>
        <textarea
          value={value.delayReason}
          onChange={(e) => set({ delayReason: e.target.value })}
          rows={2}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

export interface TaskFormValue {
  milestoneId: string;
  name: string;
  dueDate: string; // yyyy-MM-dd
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
}

export const EMPTY_TASK_FORM: TaskFormValue = {
  milestoneId: "",
  name: "",
  dueDate: "",
  status: "TODO",
  priority: "",
  description: "",
};

/**
 * Task 字段（B2-1A-2，CTO #12446）。
 * assigneeId 不开放（Create/Edit 均不发送，PATCH 不发即保留旧关联）。
 * milestone selector 只消费 page.tsx 传入的 milestoneOptions（来自 detail.milestones）。
 * 原 milestone 被软删时：unavailableMilestone 提供旧 id + 占位 label，保证 select value 稳定；
 * 同时显示 warning 提示清空或重选——不静默清空旧关联，payload 忠实发送当前 form state。
 */
export function TaskFields({
  value,
  onChange,
  statusLabels,
  priorityLabels,
  milestoneOptions,
  unavailableMilestone = null,
}: {
  value: TaskFormValue;
  onChange: (v: TaskFormValue) => void;
  statusLabels: Record<string, string>;
  priorityLabels: Record<string, string>;
  milestoneOptions: Array<{ id: string; name: string }>;
  unavailableMilestone?: { id: string; label: string } | null;
}) {
  const set = (patch: Partial<TaskFormValue>) => onChange({ ...value, ...patch });
  const milestoneUnavailable = unavailableMilestone !== null;

  return (
    <div className="space-y-3">
      {milestoneUnavailable && (
        <p className="text-xs text-status-warning-text">原关联里程碑已不可用，请清空或重新选择后保存。</p>
      )}
      <div>
        <label className="text-ink-secondary block text-xs font-medium">关联里程碑</label>
        <select
          value={value.milestoneId}
          onChange={(e) => set({ milestoneId: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {milestoneUnavailable && unavailableMilestone && (
            <option value={unavailableMilestone.id}>{unavailableMilestone.label}</option>
          )}
          <option value="">不关联里程碑</option>
          {milestoneOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">名称 *</label>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">截止日期</label>
        <input
          type="date"
          value={value.dueDate}
          onChange={(e) => set({ dueDate: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">状态</label>
        <select
          value={value.status}
          onChange={(e) => set({ status: e.target.value as TaskFormValue["status"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {Object.entries(statusLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">优先级</label>
        <select
          value={value.priority}
          onChange={(e) => set({ priority: e.target.value as TaskFormValue["priority"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          <option value="">未设置</option>
          {Object.entries(priorityLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">描述</label>
        <textarea
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={3}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** B2-1B-1：Risks（项目风险）表单字段（CTO #13589）
 * 只按真实 contract 提供字段：description(必填)/impact/probability(HIGH|MEDIUM|LOW)/mitigation/status(OPEN|MITIGATING|CLOSED)。
 * ownerId 不暴露（无正式 user selector，同 B2-1A Members 模式）：Create/Edit 均不发送。
 * status→CLOSED 只提交已有 PATCH 字段；closedAt / ProjectRiskClosed Domain Event 由 backend 负责，前端不复制。
 */
export interface RiskFormValue {
  description: string;
  impact: string;
  probability: "HIGH" | "MEDIUM" | "LOW" | "";
  mitigation: string;
  status: "OPEN" | "MITIGATING" | "CLOSED";
}

export const EMPTY_RISK_FORM: RiskFormValue = {
  description: "",
  impact: "",
  probability: "",
  mitigation: "",
  status: "OPEN",
};

export function RiskFields({
  value,
  onChange,
  statusLabels,
  probabilityLabels,
}: {
  value: RiskFormValue;
  onChange: (v: RiskFormValue) => void;
  statusLabels: Record<string, string>;
  probabilityLabels: Record<string, string>;
}) {
  const set = (patch: Partial<RiskFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">描述 *</label>
        <textarea
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={3}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">状态</label>
        <select
          value={value.status}
          onChange={(e) => set({ status: e.target.value as RiskFormValue["status"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {Object.entries(statusLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">发生概率</label>
        <select
          value={value.probability}
          onChange={(e) => set({ probability: e.target.value as RiskFormValue["probability"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          <option value="">未设置</option>
          {Object.entries(probabilityLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">影响</label>
        <input
          value={value.impact}
          onChange={(e) => set({ impact: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">应对方案</label>
        <textarea
          value={value.mitigation}
          onChange={(e) => set({ mitigation: e.target.value })}
          rows={3}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** B2-1B-1：Visits（客户走访/沟通记录）表单字段（CTO #13589）
 * 只按真实 contract 提供字段：visitType(VISIT|PHONE|VIDEO|MEETING|OTHER)/visitedAt/contactName/summary(必填)/nextAction/reminderAt。
 * visitorId 不暴露（无正式 user selector，同 B2-1A Members 模式）：Create/Edit 均不发送。
 * 不扩展 customer-contact 或 follow-up workflow 语义。
 */
export interface VisitFormValue {
  visitType: "VISIT" | "PHONE" | "VIDEO" | "MEETING" | "OTHER";
  visitedAt: string;
  contactName: string;
  summary: string;
  nextAction: string;
  reminderAt: string;
}

export const EMPTY_VISIT_FORM: VisitFormValue = {
  visitType: "VISIT",
  visitedAt: "",
  contactName: "",
  summary: "",
  nextAction: "",
  reminderAt: "",
};

export function VisitFields({
  value,
  onChange,
  visitTypeLabels,
}: {
  value: VisitFormValue;
  onChange: (v: VisitFormValue) => void;
  visitTypeLabels: Record<string, string>;
}) {
  const set = (patch: Partial<VisitFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">类型</label>
        <select
          value={value.visitType}
          onChange={(e) => set({ visitType: e.target.value as VisitFormValue["visitType"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {Object.entries(visitTypeLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">走访时间</label>
        <input
          type="date"
          value={value.visitedAt}
          onChange={(e) => set({ visitedAt: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">客户联系人</label>
        <input
          value={value.contactName}
          onChange={(e) => set({ contactName: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">沟通纪要 *</label>
        <textarea
          value={value.summary}
          onChange={(e) => set({ summary: e.target.value })}
          rows={3}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">下次行动</label>
        <input
          value={value.nextAction}
          onChange={(e) => set({ nextAction: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">提醒时间</label>
        <input
          type="date"
          value={value.reminderAt}
          onChange={(e) => set({ reminderAt: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** B2-1B-2：Products（项目产品）表单字段（CTO #13632）
 * 只按真实 project-product contract：itemId(必填，selector 消费真实 /api/items)/quantity(coerce number≥0,空)/note(≤500,空)。
 * priceSnapshotId 由报价快照流程维护，UI 不暴露（避免前端计算/伪造价格）；
 * 不前端计算项目总金额；PATCH 带 version CAS（refine 至少一个更新字段，quantity/note 为空 → null）。
 */
export interface ProductFormValue {
  itemId: string;
  quantity: string;
  note: string;
}

export const EMPTY_PRODUCT_FORM: ProductFormValue = {
  itemId: "",
  quantity: "",
  note: "",
};

export function ProductFields({
  value,
  onChange,
  itemOptions,
  unavailableItem = null,
  itemLocked = null,
  loading = false,
  error = null,
}: {
  value: ProductFormValue;
  onChange: (v: ProductFormValue) => void;
  itemOptions: Array<{ id: string; code: string | null; name: string | null }>;
  unavailableItem?: { id: string; label: string } | null;
  itemLocked?: { id: string; label: string } | null;
  loading?: boolean;
  error?: string | null;
}) {
  const set = (patch: Partial<ProductFormValue>) => onChange({ ...value, ...patch });
  const itemUnavailable = unavailableItem !== null;
  const itemLockedOn = itemLocked !== null;
  const selectorDisabled = itemLockedOn || loading || error !== null;

  return (
    <div className="space-y-3">
      {itemUnavailable && (
        <p className="text-xs text-status-warning-text">原关联物料已不可用，请重新选择后保存。</p>
      )}
      {error && (
        <p className="text-xs text-status-danger-text">物料加载失败：{error}（无法选择物料，请重试或联系管理员）</p>
      )}
      <div>
        <label className="text-ink-secondary block text-xs font-medium">物料 *</label>
        <select
          value={value.itemId}
          onChange={(e) => set({ itemId: e.target.value })}
          disabled={selectorDisabled}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-60"
        >
          {itemLockedOn && itemLocked && (
            <option value={itemLocked.id}>{itemLocked.label}</option>
          )}
          {itemUnavailable && unavailableItem && !itemLockedOn && (
            <option value={unavailableItem.id}>{unavailableItem.label}</option>
          )}
          {!itemLockedOn && !error && <option value="">{loading ? "物料加载中…" : "选择物料"}</option>}
          {!itemLockedOn &&
            !error &&
            itemOptions.map((it) => (
              <option key={it.id} value={it.id}>
                {it.code ?? ""} {it.name ?? ""}
              </option>
            ))}
        </select>
        {itemLockedOn && (
          <p className="mt-1 text-xs text-ink-muted">
            编辑时物料不可变更（PATCH 不接收 itemId），如需更换请删除后重新添加。
          </p>
        )}
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">数量</label>
        <input
          type="number"
          min={0}
          step="any"
          value={value.quantity}
          onChange={(e) => set({ quantity: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">备注</label>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={3}
          maxLength={500}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** B2-1B-2：Tags（项目标签）表单字段（CTO #13632）
 * 只支持 Add（POST tagId，重复 → backend 409 兜底）；无 Edit/PATCH，UI 不造编辑入口。
 * selector 消费真实 Tag 数据源（/api/tags）；前端可提示重复，但 backend 仍最终兜底。
 */
export interface TagFormValue {
  tagId: string;
}

export const EMPTY_TAG_FORM: TagFormValue = {
  tagId: "",
};

export function TagFields({
  value,
  onChange,
  tagOptions,
  duplicateHint = null,
  loading = false,
  error = null,
}: {
  value: TagFormValue;
  onChange: (v: TagFormValue) => void;
  tagOptions: Array<{ id: string; code: string | null; name: string | null }>;
  duplicateHint?: string | null;
  loading?: boolean;
  error?: string | null;
}) {
  const set = (patch: Partial<TagFormValue>) => onChange({ ...value, ...patch });
  const selectorDisabled = loading || error !== null;

  return (
    <div className="space-y-3">
      {duplicateHint && <p className="text-xs text-status-warning-text">{duplicateHint}</p>}
      {error && (
        <p className="text-xs text-status-danger-text">标签加载失败：{error}（无法选择标签，请重试或联系管理员）</p>
      )}
      <div>
        <label className="text-ink-secondary block text-xs font-medium">标签 *</label>
        <select
          value={value.tagId}
          onChange={(e) => set({ tagId: e.target.value })}
          disabled={selectorDisabled}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-60"
        >
          {!error && <option value="">{loading ? "标签加载中…" : "选择标签"}</option>}
          {!error &&
            tagOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ?? t.code ?? t.id}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

/** B2-2A：Budgets（项目预算）表单字段
 * 只按真实 project-budget contract：category(≤100,必填)/amount(coerce number ≥0)/currency(≤10,默认CNY)/note(≤500,空→null)。
 * 金额纪律：amount 只是单条明细事实，前端绝不求和展示总预算/预算余额（CTO B2-2A）。
 */
export interface BudgetFormValue {
  category: string;
  amount: string;
  currency: string;
  note: string;
}

export const EMPTY_BUDGET_FORM: BudgetFormValue = {
  category: "",
  amount: "",
  currency: "CNY",
  note: "",
};

export function BudgetFields({
  value,
  onChange,
}: {
  value: BudgetFormValue;
  onChange: (v: BudgetFormValue) => void;
}) {
  const set = (patch: Partial<BudgetFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">科目 *</label>
        <input
          value={value.category}
          onChange={(e) => set({ category: e.target.value })}
          maxLength={100}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">金额 *</label>
        <input
          type="number"
          min={0}
          step="any"
          value={value.amount}
          onChange={(e) => set({ amount: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">币种</label>
        <input
          value={value.currency}
          onChange={(e) => set({ currency: e.target.value })}
          maxLength={10}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">备注</label>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={2}
          maxLength={500}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** B2-2A：Expenses（项目费用/实际支出）表单字段
 * 只按真实 project-expense contract：category/amount/currency/incurredAt(发生时间,可空)/note。
 * 金额纪律同 Budget：amount 是单条支出事实，前端不求和展示总费用/费用率。
 */
export interface ExpenseFormValue {
  category: string;
  amount: string;
  currency: string;
  incurredAt: string; // yyyy-MM-dd
  note: string;
}

export const EMPTY_EXPENSE_FORM: ExpenseFormValue = {
  category: "",
  amount: "",
  currency: "CNY",
  incurredAt: "",
  note: "",
};

export function ExpenseFields({
  value,
  onChange,
}: {
  value: ExpenseFormValue;
  onChange: (v: ExpenseFormValue) => void;
}) {
  const set = (patch: Partial<ExpenseFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">科目 *</label>
        <input
          value={value.category}
          onChange={(e) => set({ category: e.target.value })}
          maxLength={100}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">金额 *</label>
        <input
          type="number"
          min={0}
          step="any"
          value={value.amount}
          onChange={(e) => set({ amount: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">币种</label>
        <input
          value={value.currency}
          onChange={(e) => set({ currency: e.target.value })}
          maxLength={10}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">发生时间</label>
        <input
          type="date"
          value={value.incurredAt}
          onChange={(e) => set({ incurredAt: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">备注</label>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={2}
          maxLength={500}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** B2-2B：Progresses（项目进展记录）表单字段
 * 只按真实 project-progress contract：recordedAt(记录时间,可空,datetime)/progressPercent(0-100,必填)/summary(≤2000,必填)。
 * 红线：Progress record 是录入事实，Project.progressPercent 是唯一 authoritative aggregate projection；
 * 前端不据 history 计算当前/平均/最大/最新进度。
 */
export interface ProgressFormValue {
  recordedAt: string; // date（YYYY-MM-DD，空 = 不提供；用户指令 2026-08-21 取消分钟）
  progressPercent: string;
  summary: string;
}

export const EMPTY_PROGRESS_FORM: ProgressFormValue = {
  recordedAt: "",
  progressPercent: "",
  summary: "",
};

export function ProgressFields({
  value,
  onChange,
}: {
  value: ProgressFormValue;
  onChange: (v: ProgressFormValue) => void;
}) {
  const set = (patch: Partial<ProgressFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">进度 %（0-100）*</label>
        <input
          type="number"
          min={0}
          max={100}
          step="any"
          value={value.progressPercent}
          onChange={(e) => set({ progressPercent: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">记录时间（可选，默认当前时间）</label>
        <input
          type="date"
          value={value.recordedAt}
          onChange={(e) => set({ recordedAt: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">进展说明 *</label>
        <textarea
          value={value.summary}
          onChange={(e) => set({ summary: e.target.value })}
          rows={3}
          maxLength={2000}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** L2-A：Acceptances（项目验收项）表单字段
 * 只按真实 project-acceptance contract：name(必填≤200)/expectedDate(可空 datetime)/actualDate(可空 datetime)/
 * result(PASSED|CONDITIONAL_PASS|FAILED|PENDING，默认 PENDING)/resultNote(可空≤1000)。
 * 红线：Acceptance 是验收事实记录，ProjectAccepted 生命周期事件由 backend 负责，前端不复制事件逻辑；
 * mutation 后一律 authoritative re-GET aggregate。
 */
export interface AcceptanceFormValue {
  name: string;
  expectedDate: string; // date（YYYY-MM-DD，空 = 不提供）
  actualDate: string; // date（YYYY-MM-DD，空 = 不提供）
  result: "PASSED" | "CONDITIONAL_PASS" | "FAILED" | "PENDING";
  resultNote: string;
}

export const EMPTY_ACCEPTANCE_FORM: AcceptanceFormValue = {
  name: "",
  expectedDate: "",
  actualDate: "",
  result: "PENDING",
  resultNote: "",
};

export function AcceptanceFields({
  value,
  onChange,
  resultLabels,
}: {
  value: AcceptanceFormValue;
  onChange: (v: AcceptanceFormValue) => void;
  resultLabels: Record<string, string>;
}) {
  const set = (patch: Partial<AcceptanceFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-ink-secondary block text-xs font-medium">验收项名称 *</label>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={200}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">计划日期（可选）</label>
        <input
          type="date"
          value={value.expectedDate}
          onChange={(e) => set({ expectedDate: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">实际日期（可选）</label>
        <input
          type="date"
          value={value.actualDate}
          onChange={(e) => set({ actualDate: e.target.value })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">验收结果</label>
        <select
          value={value.result}
          onChange={(e) => set({ result: e.target.value as AcceptanceFormValue["result"] })}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        >
          {Object.entries(resultLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-ink-secondary block text-xs font-medium">结果说明（可选）</label>
        <textarea
          value={value.resultNote}
          onChange={(e) => set({ resultNote: e.target.value })}
          rows={3}
          maxLength={1000}
          className="border-border focus:border-brand-500 mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}
