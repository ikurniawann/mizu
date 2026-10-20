import { expect, test } from "vitest";
import type { BusinessTree } from "../types";
import {
  collectDefaultExpandedBusinessIds,
  flattenBusinessTreeDisplay,
} from "./business-tree";

test("warehouse rows stay hidden until their branch is expanded", () => {
  const tree: BusinessTree = {
    holdings: [{
      id: "holding",
      name: "Holding",
      code: "H",
      is_active: true,
      companies: [{
        id: "company",
        holding_id: "holding",
        name: "Company",
        code: "C",
        is_active: true,
        branches: [{
          id: "branch",
          company_id: "company",
          name: "Branch",
          code: "B",
          is_active: true,
          warehouses: [{
            id: "warehouse",
            branch_id: "branch",
            name: "Warehouse",
            code: "W",
            is_default: true,
            is_active: true,
          }],
        }],
      }],
    }],
  };

  const expandedIds = new Set(collectDefaultExpandedBusinessIds(tree));
  expect(flattenBusinessTreeDisplay(tree, expandedIds).map((row) => row.node.kind))
    .toEqual(["holding", "company", "branch"]);

  expandedIds.add("branch");
  expect(flattenBusinessTreeDisplay(tree, expandedIds).map((row) => row.node.kind))
    .toEqual(["holding", "company", "branch", "warehouse"]);
});
