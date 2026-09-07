/**
 * 站点合规配置（中国大陆 ICP 备案）
 *
 * 工信部要求：网站首页底部中间位置展示 ICP 备案号，并链接至 https://beian.miit.gov.cn。
 * - 正式部署（linier.cn）：把此处改为阿里云备案成功的 ICP 备案号（如 "粤ICP备2025xxxxxx号-1"）
 * - 留空字符串 = 未配置 / 非大陆部署 → 前端不展示 ICP 行（登录页与系统页脚）
 */
export const ICP_BEIAN = "";

/** 工信部 ICP 备案查询官网（合规链接，目标新窗口） */
export const ICP_LINK = "https://beian.miit.gov.cn";
