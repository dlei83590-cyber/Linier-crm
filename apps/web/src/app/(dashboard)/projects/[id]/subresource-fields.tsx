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
        <p className="text-xs text-amber-600">原关联里程碑已不可用，请清空或重新选择后保存。</p>
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
