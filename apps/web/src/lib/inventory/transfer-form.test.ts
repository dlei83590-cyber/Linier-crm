import { describe, expect, it } from "vitest";
import { filterLocationsByWarehouse, splitSerialNos } from "./transfer-form";

describe("filterLocationsByWarehouse", () => {
  const locations = [
    { id: "loc-a1", warehouseId: "wh-a" },
    { id: "loc-a2", warehouseId: "wh-a" },
    { id: "loc-b1", warehouseId: "wh-b" },
    { id: "loc-none", warehouseId: null },
  ];

  it("按仓库过滤库位", () => {
    expect(filterLocationsByWarehouse(locations, "wh-a").map((l) => l.id)).toEqual([
      "loc-a1",
      "loc-a2",
    ]);
  });

  it("未选仓库时返回全部（保持下拉可用）", () => {
    expect(filterLocationsByWarehouse(locations, "").length).toBe(locations.length);
  });

  it("空列表安全", () => {
    expect(filterLocationsByWarehouse([], "wh-a")).toEqual([]);
  });
});

describe("splitSerialNos", () => {
  it("逗号分隔 + 去空白", () => {
    expect(splitSerialNos("SN1, SN2,SN3")).toEqual(["SN1", "SN2", "SN3"]);
  });

  it("空输入返回空数组", () => {
    expect(splitSerialNos("")).toEqual([]);
    expect(splitSerialNos("   ")).toEqual([]);
    expect(splitSerialNos(",,")).toEqual([]);
  });

  it("混入空项时过滤", () => {
    expect(splitSerialNos("SN1,,SN2")).toEqual(["SN1", "SN2"]);
  });
});
