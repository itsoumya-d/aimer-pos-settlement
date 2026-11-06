# aimer-pos-settlement

A TypeScript/React/Vite restaurant POS settlement and day-close dashboard:
orders, discounts, 15% GST, tips, split payments across cash/EFTPOS/Alipay/
WeChat Pay/UnionPay, refunds, processor fees, net settlement, outstanding
balances, cash variance, stock depletion and an append-only audit trail.

## Why this exists

A restaurant close is not a single total. The operator has to prove that every
order was sent to the kitchen, every payment landed against the right order,
GST and tips are separated, refunds never exceed captured money, processor fees
are attributed to the right method, stock came down once, and the cash drawer
matches the cash payments. This service makes those rules explicit and testable.

## Formulas

```text
subtotal       = sum(unitPrice * quantity)
discount       = min(subtotal, requestedDiscount)
taxable        = subtotal - discount
gst            = round(taxable * 0.15)
total          = taxable + gst + tip + serviceFee
captured       = sum(payments)
refunds        = sum(refunds)
processorFee   = sum(payment * methodFeeRate)
netSettlement  = captured - refunds - processorFee
outstanding    = max(0, total - captured + refunds)
overpaid       = max(0, captured - refunds - total)
cashVariance   = countedCash - expectedCash
```

An order flows `open → sent_to_kitchen → served → paid`; only open orders can
be voided, only kitchen orders can be served, stock is decremented once on the
kitchen transition, and refunds cannot exceed the payment they reverse.

## UI

The AutoFront close screen shows gross sales, GST, captured, net settlement and
cash variance; an order/payment table; a payment mix; a full day-close
reconciliation; and close checks for outstanding balances, overpayments, stock
and cash variance.

## Run

```bash
npm install
npm run dev
# or
npm run build
npm run preview
```

## Test

```bash
npm test
npm run build
```

Vitest covers subtotal, discount capping, GST, tips, service fees, split
payments, duplicate payments, overpayment, refunds, order states, stock
depletion, processor fees, net settlement, cash variance, close anomalies and
audit order.

## Design tokens

From Aimer's public site:

- Heading/body: Manrope
- Primary red: `#D42D37`
- Ink: `#09152B`
- Surface: `#F9F9F9`
- Muted: `#5E5E5E`
- Background: `#FFFFFF`
- Radius: `8px`
- Spacing unit: `8px`

## CI

```bash
npm ci
npm run build
npm test
```
