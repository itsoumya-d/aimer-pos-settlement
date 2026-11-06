export type Cents = number;
export type PaymentMethod = "cash" | "eftpos" | "alipay" | "wechat" | "unionpay";
export type OrderStatus = "open" | "sent_to_kitchen" | "served" | "paid" | "void";

export interface MenuItem {
  sku: string;
  name: string;
  priceCents: Cents;
}

export interface OrderLineInput {
  sku: string;
  quantity: number;
}

export interface ResolvedLine extends OrderLineInput {
  name: string;
  unitPriceCents: Cents;
  lineTotalCents: Cents;
}

export interface Payment {
  id: string;
  method: PaymentMethod;
  amountCents: Cents;
}

export interface Refund {
  id: string;
  paymentId: string;
  amountCents: Cents;
}

export interface OrderTotals {
  subtotalCents: Cents;
  discountCents: Cents;
  taxableCents: Cents;
  gstCents: Cents;
  tipCents: Cents;
  serviceFeeCents: Cents;
  totalCents: Cents;
}

export interface Order {
  id: string;
  lines: ResolvedLine[];
  status: OrderStatus;
  totals: OrderTotals;
  payments: Payment[];
  refunds: Refund[];
}

export interface OrderOptions {
  discountCents?: Cents;
  tipCents?: Cents;
  serviceFeeCents?: Cents;
}

export interface PosSettings {
  gstRate: number;
  methodFees: Record<PaymentMethod, number>;
}

export interface Settlement {
  orderId: string;
  totalCents: Cents;
  capturedCents: Cents;
  refundsCents: Cents;
  netCapturedCents: Cents;
  processorFeesCents: Cents;
  netSettlementCents: Cents;
  outstandingCents: Cents;
  overpaidCents: Cents;
}

export interface DayClose {
  orders: number;
  grossSalesCents: Cents;
  gstCents: Cents;
  tipsCents: Cents;
  capturedCents: Cents;
  refundsCents: Cents;
  processorFeesCents: Cents;
  netSettlementCents: Cents;
  expectedCashCents: Cents;
  countedCashCents: Cents;
  cashVarianceCents: Cents;
  anomalies: string[];
}

export const DEFAULT_SETTINGS: PosSettings = {
  gstRate: 0.15,
  methodFees: {
    cash: 0,
    eftpos: 0.015,
    alipay: 0.02,
    wechat: 0.02,
    unionpay: 0.018,
  },
};

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "eftpos", "alipay", "wechat", "unionpay"];

export function roundCents(value: number): Cents {
  return Math.round(value);
}

export function calculateTotals(
  lines: ResolvedLine[],
  options: OrderOptions = {},
  settings: PosSettings = DEFAULT_SETTINGS,
): OrderTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = Math.min(subtotalCents, Math.max(0, roundCents(options.discountCents ?? 0)));
  const taxableCents = subtotalCents - discountCents;
  const gstCents = roundCents(taxableCents * settings.gstRate);
  const tipCents = Math.max(0, roundCents(options.tipCents ?? 0));
  const serviceFeeCents = Math.max(0, roundCents(options.serviceFeeCents ?? 0));
  return {
    subtotalCents,
    discountCents,
    taxableCents,
    gstCents,
    tipCents,
    serviceFeeCents,
    totalCents: taxableCents + gstCents + tipCents + serviceFeeCents,
  };
}

export class PosEngine {
  private menu = new Map<string, MenuItem>();
  private stock = new Map<string, number>();
  private orders = new Map<string, Order>();
  private audit: string[] = [];
  private sequence = 1;

  constructor(menu: MenuItem[], stock: Record<string, number>, private settings: PosSettings = DEFAULT_SETTINGS) {
    for (const item of menu) this.menu.set(item.sku, item);
    for (const [sku, quantity] of Object.entries(stock)) this.stock.set(sku, quantity);
  }

  createOrder(lines: OrderLineInput[], options: OrderOptions = {}): Order {
    if (lines.length === 0) throw new Error("order must contain at least one line");
    const resolved = lines.map((line) => {
      const item = this.menu.get(line.sku);
      if (!item) throw new Error(`unknown menu item: ${line.sku}`);
      const quantity = Math.floor(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("line quantity must be a positive integer");
      return {
        sku: line.sku,
        name: item.name,
        quantity,
        unitPriceCents: item.priceCents,
        lineTotalCents: item.priceCents * quantity,
      };
    });
    const order: Order = {
      id: `order-${this.sequence++}`,
      lines: resolved,
      status: "open",
      totals: calculateTotals(resolved, options, this.settings),
      payments: [],
      refunds: [],
    };
    this.orders.set(order.id, order);
    this.audit.push(`order.created:${order.id}`);
    return order;
  }

  getOrder(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error("order not found");
    return order;
  }

  sendToKitchen(id: string): Order {
    const order = this.getOrder(id);
    if (order.status !== "open") throw new Error("only open orders can be sent to the kitchen");
    for (const line of order.lines) {
      const available = this.stock.get(line.sku) ?? 0;
      if (available < line.quantity) throw new Error(`insufficient stock for ${line.sku}`);
    }
    for (const line of order.lines) {
      this.stock.set(line.sku, (this.stock.get(line.sku) ?? 0) - line.quantity);
    }
    order.status = "sent_to_kitchen";
    this.audit.push(`order.sent:${order.id}`);
    return order;
  }

  serve(id: string): Order {
    const order = this.getOrder(id);
    if (order.status !== "sent_to_kitchen") throw new Error("only kitchen orders can be served");
    order.status = "served";
    this.audit.push(`order.served:${order.id}`);
    return order;
  }

  addPayment(id: string, payment: Payment): Order {
    const order = this.getOrder(id);
    if (order.status === "void") throw new Error("cannot pay a void order");
    if (!PAYMENT_METHODS.includes(payment.method)) throw new Error("invalid payment method");
    if (!Number.isInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error("payment must be a positive integer");
    if (order.payments.some((item) => item.id === payment.id)) throw new Error("duplicate payment id");
    order.payments.push({ ...payment });
    if (this.captured(order) >= order.totals.totalCents) order.status = "paid";
    this.audit.push(`payment.added:${order.id}:${payment.id}`);
    return order;
  }

  refund(id: string, refund: Refund): Order {
    const order = this.getOrder(id);
    const payment = order.payments.find((item) => item.id === refund.paymentId);
    if (!payment) throw new Error("payment not found");
    const already = order.refunds
      .filter((item) => item.paymentId === refund.paymentId)
      .reduce((sum, item) => sum + item.amountCents, 0);
    if (!Number.isInteger(refund.amountCents) || refund.amountCents <= 0) throw new Error("refund must be a positive integer");
    if (already + refund.amountCents > payment.amountCents) throw new Error("refund exceeds captured payment");
    order.refunds.push({ ...refund });
    if (this.captured(order) - this.refunds(order) <= 0) order.status = "void";
    else if (this.captured(order) - this.refunds(order) < order.totals.totalCents) order.status = "served";
    this.audit.push(`refund.added:${order.id}:${refund.id}`);
    return order;
  }

  voidOrder(id: string): Order {
    const order = this.getOrder(id);
    if (order.status !== "open") throw new Error("only open orders can be voided");
    order.status = "void";
    this.audit.push(`order.void:${order.id}`);
    return order;
  }

  settlement(id: string): Settlement {
    const order = this.getOrder(id);
    const captured = this.captured(order);
    const refunds = this.refunds(order);
    const netCaptured = captured - refunds;
    const processorFeesCents = roundCents(
      order.payments.reduce((sum, payment) => sum + payment.amountCents * this.settings.methodFees[payment.method], 0),
    );
    return {
      orderId: order.id,
      totalCents: order.totals.totalCents,
      capturedCents: captured,
      refundsCents: refunds,
      netCapturedCents: netCaptured,
      processorFeesCents,
      netSettlementCents: netCaptured - processorFeesCents,
      outstandingCents: Math.max(0, order.totals.totalCents - netCaptured),
      overpaidCents: Math.max(0, netCaptured - order.totals.totalCents),
    };
  }

  closeDay(countedCashCents = 0): DayClose {
    const orders = [...this.orders.values()].filter((order) => order.status !== "void" || order.payments.length > 0);
    const result: DayClose = {
      orders: orders.length,
      grossSalesCents: 0,
      gstCents: 0,
      tipsCents: 0,
      capturedCents: 0,
      refundsCents: 0,
      processorFeesCents: 0,
      netSettlementCents: 0,
      expectedCashCents: 0,
      countedCashCents,
      cashVarianceCents: 0,
      anomalies: [],
    };
    for (const order of orders) {
      const settlement = this.settlement(order.id);
      result.grossSalesCents += order.totals.totalCents;
      result.gstCents += order.totals.gstCents;
      result.tipsCents += order.totals.tipCents;
      result.capturedCents += settlement.capturedCents;
      result.refundsCents += settlement.refundsCents;
      result.processorFeesCents += settlement.processorFeesCents;
      result.netSettlementCents += settlement.netSettlementCents;
      result.expectedCashCents += order.payments
        .filter((payment) => payment.method === "cash")
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      result.expectedCashCents -= order.refunds
        .filter((refund) => order.payments.find((payment) => payment.id === refund.paymentId)?.method === "cash")
        .reduce((sum, refund) => sum + refund.amountCents, 0);
      if (settlement.outstandingCents > 0) result.anomalies.push(`${order.id}: ${settlement.outstandingCents} cents outstanding`);
      if (settlement.overpaidCents > 0) result.anomalies.push(`${order.id}: ${settlement.overpaidCents} cents overpaid`);
    }
    result.cashVarianceCents = countedCashCents - result.expectedCashCents;
    if (orders.length === 0) result.anomalies.push("no orders in day close");
    if (result.cashVarianceCents !== 0) result.anomalies.push(`cash variance: ${result.cashVarianceCents} cents`);
    return result;
  }

  getAudit(): string[] {
    return [...this.audit];
  }

  getStock(): Record<string, number> {
    return Object.fromEntries(this.stock);
  }

  private captured(order: Order): Cents {
    return order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  }

  private refunds(order: Order): Cents {
    return order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
  }
}

export function formatNZD(cents: Cents): string {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", minimumFractionDigits: 2 }).format(cents / 100);
}
