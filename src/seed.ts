import { PosEngine, type MenuItem } from "./pos.js";

export const menu: MenuItem[] = [
  { sku: "bubble-tea", name: "Brown Sugar Bubble Tea", priceCents: 850 },
  { sku: "dumplings", name: "Pork & Chive Dumplings", priceCents: 1_200 },
  { sku: "rice-bowl", name: "Char Siu Rice Bowl", priceCents: 1_650 },
  { sku: "jasmine-tea", name: "Jasmine Iced Tea", priceCents: 650 },
];

export function seed(): { engine: PosEngine; orderIds: string[] } {
  const engine = new PosEngine(menu, {
    "bubble-tea": 20,
    dumplings: 12,
    "rice-bowl": 8,
    "jasmine-tea": 15,
  });

  const first = engine.createOrder(
    [
      { sku: "bubble-tea", quantity: 2 },
      { sku: "dumplings", quantity: 1 },
    ],
    { discountCents: 200, tipCents: 200 },
  );
  engine.sendToKitchen(first.id);
  engine.serve(first.id);
  engine.addPayment(first.id, { id: "pay-1", method: "eftpos", amountCents: first.totals.totalCents });

  const second = engine.createOrder(
    [
      { sku: "rice-bowl", quantity: 1 },
      { sku: "jasmine-tea", quantity: 1 },
    ],
    { serviceFeeCents: 100 },
  );
  engine.sendToKitchen(second.id);
  engine.serve(second.id);
  engine.addPayment(second.id, { id: "pay-2a", method: "alipay", amountCents: 2_000 });
  engine.addPayment(second.id, { id: "pay-2b", method: "cash", amountCents: 745 });

  const third = engine.createOrder([{ sku: "dumplings", quantity: 3 }]);
  engine.sendToKitchen(third.id);
  engine.serve(third.id);
  engine.addPayment(third.id, { id: "pay-3", method: "eftpos", amountCents: third.totals.totalCents });

  return { engine, orderIds: [first.id, second.id, third.id] };
}
