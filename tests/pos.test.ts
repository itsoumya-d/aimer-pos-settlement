import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, PosEngine, calculateTotals, formatNZD, type MenuItem } from "../src/pos.js";

const menu: MenuItem[] = [
  { sku: "tea", name: "Bubble Tea", priceCents: 850 },
  { sku: "dumplings", name: "Dumplings", priceCents: 1_200 },
  { sku: "rice", name: "Rice Bowl", priceCents: 1_650 },
];

function engine(): PosEngine {
  return new PosEngine(menu, { tea: 20, dumplings: 10, rice: 5 });
}

function paidOrder(e: PosEngine, id = "pay-1") {
  const order = e.createOrder([{ sku: "tea", quantity: 2 }], { tipCents: 200 });
  e.sendToKitchen(order.id);
  e.serve(order.id);
  e.addPayment(order.id, { id, method: "eftpos", amountCents: order.totals.totalCents });
  return order;
}

describe("Aimer POS settlement engine", () => {
  it("calculates order subtotal", () => {
    const order = engine().createOrder([{ sku: "tea", quantity: 2 }, { sku: "dumplings", quantity: 1 }]);
    expect(order.totals.subtotalCents).toBe(2_900);
  });

  it("caps discount at subtotal", () => {
    const order = engine().createOrder([{ sku: "tea", quantity: 1 }], { discountCents: 10_000 });
    expect(order.totals.discountCents).toBe(850);
    expect(order.totals.totalCents).toBe(0);
  });

  it("applies 15% GST after discount", () => {
    const order = engine().createOrder([{ sku: "tea", quantity: 2 }], { discountCents: 200 });
    expect(order.totals.taxableCents).toBe(1_500);
    expect(order.totals.gstCents).toBe(225);
  });

  it("adds tip and service fee after GST", () => {
    const order = engine().createOrder([{ sku: "tea", quantity: 2 }], { tipCents: 200, serviceFeeCents: 100 });
    expect(order.totals.totalCents).toBe(1_700 + 255 + 200 + 100);
  });

  it("resolves menu names and unit prices", () => {
    const order = engine().createOrder([{ sku: "rice", quantity: 2 }]);
    expect(order.lines[0]).toMatchObject({ name: "Rice Bowl", unitPriceCents: 1_650, lineTotalCents: 3_300 });
  });

  it("decrements stock when sent to the kitchen", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 3 }]);
    e.sendToKitchen(order.id);
    expect(e.getStock().tea).toBe(17);
  });

  it("rejects insufficient stock", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "rice", quantity: 6 }]);
    expect(() => e.sendToKitchen(order.id)).toThrow(/insufficient stock/);
  });

  it("rejects unknown menu items", () => {
    expect(() => engine().createOrder([{ sku: "missing", quantity: 1 }])).toThrow(/unknown menu item/);
  });

  it("rejects non-positive quantities", () => {
    expect(() => engine().createOrder([{ sku: "tea", quantity: 0 }])).toThrow(/positive integer/);
  });

  it("rejects empty orders", () => {
    expect(() => engine().createOrder([])).toThrow(/at least one line/);
  });

  it("moves an open order to the kitchen", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    expect(e.sendToKitchen(order.id).status).toBe("sent_to_kitchen");
  });

  it("moves a kitchen order to served", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    e.sendToKitchen(order.id);
    expect(e.serve(order.id).status).toBe("served");
  });

  it("rejects serving an open order", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    expect(() => e.serve(order.id)).toThrow(/kitchen orders/);
  });

  it("accepts a split payment", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 2 }]);
    e.sendToKitchen(order.id);
    e.serve(order.id);
    e.addPayment(order.id, { id: "p1", method: "alipay", amountCents: 1_000 });
    e.addPayment(order.id, { id: "p2", method: "cash", amountCents: 955 });
    expect(order.payments).toHaveLength(2);
  });

  it("marks a fully paid order paid", () => {
    const e = engine();
    const order = paidOrder(e);
    expect(order.status).toBe("paid");
  });

  it("allows an overpayment and reports it in settlement", () => {
    const e = engine();
    const order = paidOrder(e, "pay-over");
    e.addPayment(order.id, { id: "pay-extra", method: "cash", amountCents: 100 });
    const settlement = e.settlement(order.id);
    expect(settlement.overpaidCents).toBe(100);
  });

  it("rejects duplicate payment ids", () => {
    const e = engine();
    const order = paidOrder(e, "pay-dup");
    expect(() => e.addPayment(order.id, { id: "pay-dup", method: "cash", amountCents: 1 })).toThrow(/duplicate/);
  });

  it("rejects an invalid payment method", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    expect(() => e.addPayment(order.id, { id: "p1", method: "bitcoin" as never, amountCents: 100 })).toThrow(/invalid payment/);
  });

  it("refunds part of a payment", () => {
    const e = engine();
    const order = paidOrder(e);
    e.refund(order.id, { id: "refund-1", paymentId: "pay-1", amountCents: 500 });
    expect(e.settlement(order.id).refundsCents).toBe(500);
  });

  it("rejects a refund larger than the payment", () => {
    const e = engine();
    const order = paidOrder(e);
    expect(() => e.refund(order.id, { id: "refund-big", paymentId: "pay-1", amountCents: 99_999 })).toThrow(/exceeds/);
  });

  it("returns an over-refunded order to served", () => {
    const e = engine();
    const order = paidOrder(e);
    e.refund(order.id, { id: "refund-1", paymentId: "pay-1", amountCents: 500 });
    expect(order.status).toBe("served");
  });

  it("voids a fully refunded order", () => {
    const e = engine();
    const order = paidOrder(e);
    e.refund(order.id, { id: "refund-all", paymentId: "pay-1", amountCents: order.totals.totalCents });
    expect(order.status).toBe("void");
  });

  it("voids only an open order", () => {
    const e = engine();
    const open = e.createOrder([{ sku: "tea", quantity: 1 }]);
    expect(e.voidOrder(open.id).status).toBe("void");
    const paid = paidOrder(e, "pay-2");
    expect(() => e.voidOrder(paid.id)).toThrow(/only open/);
  });

  it("rejects payment on a void order", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    e.voidOrder(order.id);
    expect(() => e.addPayment(order.id, { id: "p1", method: "cash", amountCents: 100 })).toThrow(/void/);
  });

  it("calculates processor fees by method", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 2 }], { tipCents: 200 });
    e.sendToKitchen(order.id);
    e.serve(order.id);
    e.addPayment(order.id, { id: "p1", method: "eftpos", amountCents: order.totals.totalCents });
    expect(e.settlement(order.id).processorFeesCents).toBe(32);
  });

  it("calculates net settlement", () => {
    const e = engine();
    const order = paidOrder(e);
    expect(e.settlement(order.id).netSettlementCents).toBe(2_123);
  });

  it("reports outstanding balance", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 2 }]);
    e.sendToKitchen(order.id);
    e.serve(order.id);
    e.addPayment(order.id, { id: "p1", method: "cash", amountCents: 500 });
    expect(e.settlement(order.id).outstandingCents).toBe(1_455);
  });

  it("closes a day with balanced totals", () => {
    const e = engine();
    paidOrder(e, "p1");
    const close = e.closeDay(1_700);
    expect(close.orders).toBe(1);
    expect(close.grossSalesCents).toBe(2_155);
    expect(close.gstCents).toBe(255);
    expect(close.tipsCents).toBe(200);
    expect(close.processorFeesCents).toBe(32);
    expect(close.netSettlementCents).toBe(2_123);
    expect(close.cashVarianceCents).toBe(1_700);
  });

  it("reports a cash variance", () => {
    const e = engine();
    paidOrder(e);
    const close = e.closeDay(1_650);
    expect(close.expectedCashCents).toBe(0);
    expect(close.cashVarianceCents).toBe(1_650);
  });

  it("flags outstanding orders in the close", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    e.sendToKitchen(order.id);
    e.serve(order.id);
    e.addPayment(order.id, { id: "p1", method: "cash", amountCents: 100 });
    const close = e.closeDay(100);
    expect(close.anomalies.some((item) => item.includes("outstanding"))).toBe(true);
  });

  it("flags an empty day close", () => {
    const e = new PosEngine(menu, { tea: 1, dumplings: 1, rice: 1 });
    const close = e.closeDay(0);
    expect(close.anomalies).toContain("no orders in day close");
  });

  it("formats NZD values", () => {
    expect(formatNZD(123_456)).toBe("$1,234.56");
  });

  it("records an ordered audit trail", () => {
    const e = engine();
    const order = e.createOrder([{ sku: "tea", quantity: 1 }]);
    e.sendToKitchen(order.id);
    e.serve(order.id);
    e.addPayment(order.id, { id: "p1", method: "cash", amountCents: order.totals.totalCents });
    expect(e.getAudit()).toEqual([
      `order.created:${order.id}`,
      `order.sent:${order.id}`,
      `order.served:${order.id}`,
      `payment.added:${order.id}:p1`,
    ]);
  });

  it("exposes settings without mutation", () => {
    const e = new PosEngine(menu, { tea: 1, dumplings: 1, rice: 1 }, DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.gstRate).toBe(0.15);
    expect(e.getStock()).toEqual({ tea: 1, dumplings: 1, rice: 1 });
  });
});
