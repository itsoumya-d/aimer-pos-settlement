import { useMemo, useState } from "react";
import { formatNZD, type Order, type PaymentMethod } from "./pos.js";
import { seed } from "./seed.js";

const methodLabel: Record<PaymentMethod, string> = {
  cash: "Cash",
  eftpos: "EFTPOS",
  alipay: "Alipay",
  wechat: "WeChat Pay",
  unionpay: "UnionPay",
};

export function App() {
  const [closed, setClosed] = useState(false);
  const { engine, orderIds } = useMemo(() => seed(), []);
  const orders = orderIds.map((id) => engine.getOrder(id));
  const dayClose = useMemo(() => engine.closeDay(745), [engine]);
  const settlements = useMemo(() => orderIds.map((id) => engine.settlement(id)), [engine, orderIds]);

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">AutoFront · store close</p>
          <h1>Every order, payment and settlement in one close.</h1>
          <p className="lede">
            POS orders, GST, split payments, processor fees, cash variance and
            stock depletion reconciled into a single daily close.
          </p>
        </div>
        <div className="mast-actions">
          <span className={closed ? "status closed" : "status"}>{closed ? "Day closed" : "Open trading day"}</span>
          <button className="primary" onClick={() => setClosed(true)}>Close day</button>
        </div>
      </header>

      <section className="metrics">
        <Metric label="Gross sales" value={formatNZD(dayClose.grossSalesCents)} />
        <Metric label="GST" value={formatNZD(dayClose.gstCents)} />
        <Metric label="Captured" value={formatNZD(dayClose.capturedCents)} />
        <Metric label="Net settlement" value={formatNZD(dayClose.netSettlementCents)} tone="primary" />
        <Metric label="Cash variance" value={formatNZD(dayClose.cashVarianceCents)} tone="dark" />
      </section>

      <main className="grid">
        <section className="panel orders">
          <div className="panel-head">
            <div>
              <h2>Orders</h2>
              <p>{orders.length} paid orders · {dayClose.orders} in close</p>
            </div>
            <span className="pill">NZD · GST 15%</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Lines</th>
                  <th className="num">Total</th>
                  <th className="num">Captured</th>
                  <th className="num">Fees</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, index) => (
                  <tr key={order.id}>
                    <td><strong>{order.id}</strong><small>{order.lines.length} items</small></td>
                    <td>{order.lines.map((line) => `${line.quantity}× ${line.name}`).join(", ")}</td>
                    <td className="num">{formatNZD(order.totals.totalCents)}</td>
                    <td className="num">{formatNZD(settlements[index].capturedCents)}</td>
                    <td className="num">{formatNZD(settlements[index].processorFeesCents)}</td>
                    <td><span className={`badge ${order.status}`}>{order.status.replaceAll("_", " ")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel payments">
          <div className="panel-head"><h2>Payment mix</h2></div>
          <PaymentMix orders={orders} />
          <div className="callout">
            <strong>Close checks</strong>
            <p>Outstanding balances, overpayments, processor fees and cash variance are checked across the day.</p>
          </div>
        </aside>

        <section className="panel settlement">
          <div className="panel-head"><h2>Day close</h2><span>{closed ? "Locked" : "Draft"}</span></div>
          <dl>
            <div><dt>Gross sales</dt><dd>{formatNZD(dayClose.grossSalesCents)}</dd></div>
            <div><dt>GST</dt><dd>{formatNZD(dayClose.gstCents)}</dd></div>
            <div><dt>Tips</dt><dd>{formatNZD(dayClose.tipsCents)}</dd></div>
            <div><dt>Captured</dt><dd>{formatNZD(dayClose.capturedCents)}</dd></div>
            <div><dt>Processor fees</dt><dd>-{formatNZD(dayClose.processorFeesCents)}</dd></div>
            <div><dt>Refunds</dt><dd>{formatNZD(dayClose.refundsCents)}</dd></div>
            <div className="total"><dt>Net settlement</dt><dd>{formatNZD(dayClose.netSettlementCents)}</dd></div>
            <div><dt>Expected cash</dt><dd>{formatNZD(dayClose.expectedCashCents)}</dd></div>
            <div><dt>Counted cash</dt><dd>{formatNZD(dayClose.countedCashCents)}</dd></div>
            <div><dt>Cash variance</dt><dd>{formatNZD(dayClose.cashVarianceCents)}</dd></div>
          </dl>
        </section>

        <section className="panel checks">
          <div className="panel-head"><h2>Close checks</h2><span>{dayClose.anomalies.length} open</span></div>
          <ul>
            {dayClose.anomalies.length === 0 ? <li className="ok">No anomalies. The day balances.</li> : dayClose.anomalies.map((anomaly) => <li key={anomaly}>{anomaly}</li>)}
          </ul>
        </section>

        <section className="panel notes">
          <div className="panel-head"><h2>Engine logic</h2></div>
          <div className="note-grid">
            <Note title="Order total" body="Subtotal − discount + 15% GST + tip + service fee." />
            <Note title="Split payments" body="Cash, EFTPOS, Alipay, WeChat Pay and UnionPay captured against the same order." />
            <Note title="Settlement" body="Captured − refunds − method processor fees = net settlement." />
            <Note title="Close" body="Expected cash and counted cash produce the cash variance and close checks." />
          </div>
        </section>
      </main>

      <footer><span>TypeScript · React · Vite · Vitest</span><span>Reference implementation for Aimer AutoFront</span></footer>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "primary" | "dark" }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function Note({ title, body }: { title: string; body: string }) {
  return <div className="note"><strong>{title}</strong><p>{body}</p></div>;
}

function PaymentMix({ orders }: { orders: Order[] }) {
  const totals = new Map<PaymentMethod, number>();
  for (const order of orders) {
    for (const payment of order.payments) {
      totals.set(payment.method, (totals.get(payment.method) ?? 0) + payment.amountCents);
    }
  }
  return (
    <ul className="mix">
      {[...totals.entries()].map(([method, amount]) => (
        <li key={method}><span>{methodLabel[method]}</span><b>{formatNZD(amount)}</b></li>
      ))}
    </ul>
  );
}
