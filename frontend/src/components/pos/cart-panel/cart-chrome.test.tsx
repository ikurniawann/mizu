import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CartActions } from "./cart-chrome";

afterEach(cleanup);

it("does not offer Order again while paying an existing Spa bill", () => {
  render(<CartActions canTransact empty={false} isSavingBill={false} orderLabel="Order"
    payLabel="Pay Rp 90.000" onPay={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Order" })).toBeNull();
  expect(screen.getByRole("button", { name: "Pay Rp 90.000" })).toBeTruthy();
});
