export interface AuditFields {
  createdAt: Date;
  updatedAt: Date;
}

export type Nullable<T> = T | null;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export interface PaginationParams {
  page: number;
  pageSize: number;
}
