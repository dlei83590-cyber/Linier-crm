"use client";

/**
 * useReferenceOptions — 表单引用数据源加载（物料管理引用下拉加载修复，FRT-01 前端补齐）
 *
 * 问题（用户报告）：物料「新建 / 编辑」表单里 —— 分类 / 库存单位 / 采购单位 / 销售单位 / 供应商
 * 下拉全部为空。根因是取数结构：页面此前用**单个 Promise.all** 一次性拉取 4 个引用源，
 * 任一接口失败（403 无权限 / 500 / 网络）都会让整组下拉一起空白，且只显示一句笼统文案，
 * 无法判断是哪个源失败、也无法单独重试。
 *
 * 本 hook 为**每个引用源提供独立状态**：
 * - 独立 loading / data / error / reload：一个源失败不影响其他源（禁止级联清空）；
 * - 失败可见：保留 ApiClientError（status / code / message），由调用方按字段渲染 + 重试；
 * - 禁止 silent degradation：失败不伪造空数组假装成功（首次失败 data=[] 且 error 非空；
 *   重试失败保留上一次成功结果，绝不静默丢弃）。
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";

export interface ReferenceOptions<T> {
  /** 已成功加载的选项（失败时保留上一次成功结果，不伪造新值） */
  data: T[];
  loading: boolean;
  /** 真实失败原因（status / code / message 原样保留，不做字符串降级） */
  error: ApiClientError | null;
  /** 重新加载该源（字段级「重试」） */
  reload: () => void;
}

export function useReferenceOptions<T>(url: string): ReferenceOptions<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<T[]>(url, { signal: controller.signal })
      .then((body) => {
        // 契约：引用源必须是数组（success envelope 的 data）；非数组即视为加载失败，不静默降级
        if (!Array.isArray(body.data)) {
          setError(new ApiClientError(500, "引用数据格式非法（data 不是列表）", "INVALID_RESPONSE"));
          setLoading(false);
          return;
        }
        setData(body.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // 组件卸载 / 依赖变化导致的中断不算失败
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [url, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

/**
 * 引用源失败文案（面向业务用户）：
 * - 401 / 403（含密码策略 403）给出可执行结论，不只丢后端英文 message；
 * - 其余状态保留 HTTP 语义 + 后端 error.code / message（真实事实，不美化）。
 *
 * @param permission 该源对应的后端权限码（403 时明确告知缺哪个权限，便于管理员授权）
 */
export function referenceErrorText(
  error: ApiClientError | null,
  permission?: string,
): string | null {
  if (!error) return null;
  if (error.status === 401) return "登录状态已失效，请重新登录";
  if (error.status === 403) {
    if (error.code === "PASSWORD_CHANGE_REQUIRED") {
      return "当前账号仍在使用初始密码，请先修改密码后再使用系统功能";
    }
    return permission
      ? "无权限访问（403）：缺少「" + permission + "」权限，请联系管理员授权"
      : "无权限访问（403）：请联系管理员授权";
  }
  if (error.status === 0) return "网络错误：无法连接服务器，请重试";
  return describeStatus(error.status) + (error.code ? "（" + error.code + "）" : "") + "：" + error.message;
}
