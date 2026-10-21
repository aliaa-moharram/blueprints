// The Lean product library. Every blueprint built in the admin page picks from this list.
// Edit here when Lean's products or docs change; new and republished blueprints pick it up.
//
// Fields: name, sub (short label under the name), card (product card text), apis (endpoint
// chips), apiNote (text under the endpoints; "{client}" becomes the client's name), effort
// (default, editable per blueprint), panel (guide panel id, or null), linkFromDesign
// (label for a link to the blueprint's Figma file), toBeScoped (shows a "To be scoped" chip),
// showCard (whether it gets a product card by default).
//
// Panel checklist items get stable keys (<panel>-1, <panel>-2, ...), which is what saved
// ticks are tied to. Add new steps at the end of a list so existing ticks stay in place.

export const PRODUCTS = [
  {
    "id": "otp",
    "name": "One-Time Payments",
    "sub": "a Charge per payment",
    "card": "A single Pay by Bank payment, represented by a Charge, collected directly from the customer's bank account.",
    "apis": [
      "POST /v4/payment-charges",
      "GET /v4/payment-charges/{id}",
      "Hosted authentication (redirect)"
    ],
    "apiNote": "",
    "effort": "~1 week",
    "panel": "otp",
    "showCard": true
  },
  {
    "id": "rec",
    "name": "Recurring Payments",
    "sub": "Payment Agreement",
    "card": "A Payment Agreement gives reusable permission to charge: on demand, on a schedule, or in instalments.",
    "apis": [
      "POST /v4/payment-agreements",
      "POST /v4/payment-agreements/{id}/payment-charges",
      "POST /v4/payment-agreements/{id}/revocations"
    ],
    "apiNote": "",
    "effort": "~1 week",
    "panel": "rec",
    "showCard": true
  },
  {
    "id": "cmi",
    "name": "Consent Management Interface",
    "sub": "CMI, required before go-live",
    "card": "Lets users see their Open Finance payment history and Payment Agreements, and revoke an agreement at any time. Required by the Open Finance framework before go-live.",
    "apis": [],
    "apiNote": "{client} builds the frontend and backend from Lean-provided Figma screens. Lean will also share the functional requirements and acceptance criteria.",
    "effort": "~1-2 weeks",
    "panel": null,
    "linkFromDesign": "CMI screens (Figma)",
    "showCard": false
  },
  {
    "id": "namematch",
    "name": "Name match at initiation",
    "sub": "Lean-side match",
    "card": "Lean matches the bank-returned account holder name against the customer name at payment initiation and rejects mismatches before money moves.",
    "apis": [
      "customer.name",
      "instrument.holder_name"
    ],
    "apiNote": "In development at Lean, targeted for Q4. Once live, Lean matches the bank-returned account holder name against the customer name on its side, enabled as a trait with no customer action, and rejects mismatches before money moves. Whether the name is also returned on webhooks is being confirmed.",
    "effort": "Lean build, Q4",
    "panel": null,
    "showCard": false
  },
  {
    "id": "payouts",
    "name": "Payouts",
    "sub": "server-to-server",
    "card": "Outbound transfers to UAE bank accounts, initiated server-side.",
    "apis": [
      "POST /payouts/v1/payment/destinations",
      "POST /payouts/v1/payment"
    ],
    "apiNote": "",
    "effort": "~5 eng-days",
    "panel": "pay",
    "showCard": true
  },
  {
    "id": "data",
    "name": "Data",
    "sub": "account information",
    "card": "Account insights for income-based decisions, such as salary verification for lending and credit limit increases.",
    "apis": [],
    "apiNote": "",
    "toBeScoped": true,
    "effort": "TBC",
    "panel": null,
    "showCard": true
  },
  {
    "id": "cards",
    "name": "Cards",
    "sub": "same integration",
    "card": "Cards and further payment methods as values on the same Charge integration, with no re-integration.",
    "apis": [
      "payment_method"
    ],
    "apiNote": "",
    "effort": "TBC",
    "panel": null,
    "showCard": true
  }
];

export const PANELS = {
  "otp": {
    "title": "One-Time Payments",
    "sub": "Accept a single Pay by Bank payment. Each payment is a standalone Charge, tracked from creation through authentication to its outcome.",
    "pre": [
      "Authenticate with the Lean API.",
      "Create a <b>Settlement Account</b> for the funds you collect.",
      "Configure a webhook endpoint with signature verification."
    ],
    "steps": [
      "Create a Charge from the backend: <code>POST /v4/payment-charges</code> with the amount, customer, <code>settlement_account_id</code> and an <code>Idempotency-Key</code>.",
      "Send the customer to the returned hosted authentication URL: a redirect on web, or a WebView with a deep link back into the app.",
      "Treat the customer's return as the end of authentication, not the payment result.",
      "Check the outcome with <code>GET /v4/payment-charges/{id}</code> and handle <code>CAPTURED</code>, <code>DECLINED</code> and <code>DISCARDED</code>. The customer has 10 minutes to authenticate; declined and discarded are terminal, so retries mean a new Charge.",
      "Listen for <code>charge.captured</code>, <code>charge.declined</code> and <code>charge.discarded</code> webhooks; tolerate duplicate and out-of-order delivery.",
      "Test in Sandbox: a successful payment, a decline, abandoned authentication, an idempotent retry, and a duplicate webhook."
    ],
    "svg": "<svg class=\"seqsvg\" viewBox=\"0 0 500 310\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><style>.lb{font:700 11.5px Arial,Helvetica,sans-serif;fill:#1c2024}.ms{font:500 10.5px Arial,Helvetica,sans-serif;fill:#1c2024}.mm{font:italic 500 10.5px Arial,Helvetica,sans-serif;fill:#6b7280}</style><line x1=\"40.0\" y1=\"34\" x2=\"40.0\" y2=\"300\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"-12.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"40.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Wise backend</text><line x1=\"250.0\" y1=\"34\" x2=\"250.0\" y2=\"300\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"198.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"250.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Lean</text><line x1=\"460.0\" y1=\"34\" x2=\"460.0\" y2=\"300\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"408.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"460.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Customer</text><line x1=\"40.0\" y1=\"60\" x2=\"244.0\" y2=\"60\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M242.0 56 L250.0 60 L242.0 64 Z\" fill=\"#1c2024\"/><text x=\"145.0\" y=\"55\" text-anchor=\"middle\" class=\"ms\">Create Charge  (POST /v4/payment-charges)</text><line x1=\"250.0\" y1=\"94\" x2=\"46.0\" y2=\"94\" style=\"stroke:var(--bright)\" stroke-width=\"1.6\"/><path d=\"M48.0 90 L40.0 94 L48.0 98 Z\" style=\"fill:var(--bright)\"/><text x=\"145.0\" y=\"89\" text-anchor=\"middle\" class=\"ms\">Charge + hosted auth URL</text><line x1=\"40.0\" y1=\"128\" x2=\"454.0\" y2=\"128\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M452.0 124 L460.0 128 L452.0 132 Z\" fill=\"#1c2024\"/><text x=\"250.0\" y=\"123\" text-anchor=\"middle\" class=\"ms\">Send customer to authenticate</text><line x1=\"460.0\" y1=\"162\" x2=\"256.0\" y2=\"162\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M258.0 158 L250.0 162 L258.0 166 Z\" fill=\"#1c2024\"/><text x=\"355.0\" y=\"157\" text-anchor=\"middle\" class=\"ms\">Customer authenticates with their bank</text><line x1=\"250.0\" y1=\"196\" x2=\"46.0\" y2=\"196\" stroke=\"#6b7280\" stroke-width=\"1.6\" stroke-dasharray=\"5 4\"/><path d=\"M48.0 192 L40.0 196 L48.0 200 Z\" fill=\"#6b7280\"/><text x=\"145.0\" y=\"191\" text-anchor=\"middle\" class=\"ms\">charge.captured webhook</text><line x1=\"40.0\" y1=\"230\" x2=\"244.0\" y2=\"230\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M242.0 226 L250.0 230 L242.0 234 Z\" fill=\"#1c2024\"/><text x=\"145.0\" y=\"225\" text-anchor=\"middle\" class=\"ms\">Fetch Charge  (GET /v4/payment-charges/{id})</text><line x1=\"250.0\" y1=\"264\" x2=\"46.0\" y2=\"264\" style=\"stroke:var(--bright)\" stroke-width=\"1.6\"/><path d=\"M48.0 260 L40.0 264 L48.0 268 Z\" style=\"fill:var(--bright)\"/><text x=\"145.0\" y=\"259\" text-anchor=\"middle\" class=\"ms\">Charge status: CAPTURED</text></svg>",
    "endpoints": [
      "POST /v4/payment-charges",
      "GET /v4/payment-charges/{charge_id}"
    ],
    "links": [
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/one-time-payments",
        "label": "Accept a one-time payment"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/getting-started-with-payments",
        "label": "Payments overview"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/payment-webhooks",
        "label": "Payment webhooks"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/errors-and-troubleshooting",
        "label": "Errors and troubleshooting"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentcharge",
        "label": "API reference: Payment Charges"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentinstrument",
        "label": "API reference: Payment Instruments"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/postoauth2token",
        "label": "API reference: Authentication"
      }
    ],
    "note": ""
  },
  "rec": {
    "title": "Recurring Payments",
    "sub": "Collect repeat payments under one Payment Agreement: reusable permission to charge the customer on demand, on a schedule, or in instalments.",
    "pre": [
      "Authenticate with the Lean API.",
      "Create a <b>Settlement Account</b> for the funds you collect.",
      "Configure a webhook endpoint with signature verification."
    ],
    "steps": [
      "Create a Payment Agreement: <code>POST /v4/payment-agreements</code> with the payment method, currency, customer and limits such as <code>per_charge_max_amount</code> and an expiry date.",
      "Send the customer to the hosted authentication URL to authorise the agreement.",
      "Confirm activation through the <code>agreement.activated</code> webhook or <code>GET /v4/payment-agreements/{id}</code>; only charge an <code>ACTIVE</code> agreement.",
      "Charge on demand with <code>POST /v4/payment-agreements/{id}/payment-charges</code> and an <code>Idempotency-Key</code>, or let Lean run a <code>RECURRING</code> or instalment plan on the agreement.",
      "Handle the lifecycle: pause, resume and revoke endpoints. <code>REVOKED</code>, <code>FULFILLED</code>, <code>DECLINED</code> and <code>DISCARDED</code> are terminal.",
      "Track the agreement status separately from each Charge's status, and listen for both <code>agreement.*</code> and <code>charge.*</code> webhooks.",
      "Test in Sandbox: activation, declined and abandoned authorisation, a charge over the agreement limits, revocation, and duplicate webhooks."
    ],
    "svg": "<svg class=\"seqsvg\" viewBox=\"0 0 500 344\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><style>.lb{font:700 11.5px Arial,Helvetica,sans-serif;fill:#1c2024}.ms{font:500 10.5px Arial,Helvetica,sans-serif;fill:#1c2024}.mm{font:italic 500 10.5px Arial,Helvetica,sans-serif;fill:#6b7280}</style><line x1=\"40.0\" y1=\"34\" x2=\"40.0\" y2=\"334\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"-12.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"40.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Wise backend</text><line x1=\"250.0\" y1=\"34\" x2=\"250.0\" y2=\"334\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"198.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"250.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Lean</text><line x1=\"460.0\" y1=\"34\" x2=\"460.0\" y2=\"334\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"408.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"460.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Customer</text><line x1=\"40.0\" y1=\"60\" x2=\"244.0\" y2=\"60\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M242.0 56 L250.0 60 L242.0 64 Z\" fill=\"#1c2024\"/><text x=\"145.0\" y=\"55\" text-anchor=\"middle\" class=\"ms\">Create Agreement  (POST /v4/payment-agreements)</text><line x1=\"250.0\" y1=\"94\" x2=\"46.0\" y2=\"94\" style=\"stroke:var(--bright)\" stroke-width=\"1.6\"/><path d=\"M48.0 90 L40.0 94 L48.0 98 Z\" style=\"fill:var(--bright)\"/><text x=\"145.0\" y=\"89\" text-anchor=\"middle\" class=\"ms\">Agreement + hosted auth URL</text><line x1=\"40.0\" y1=\"128\" x2=\"454.0\" y2=\"128\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M452.0 124 L460.0 128 L452.0 132 Z\" fill=\"#1c2024\"/><text x=\"250.0\" y=\"123\" text-anchor=\"middle\" class=\"ms\">Send customer to authorise the agreement</text><line x1=\"460.0\" y1=\"162\" x2=\"256.0\" y2=\"162\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M258.0 158 L250.0 162 L258.0 166 Z\" fill=\"#1c2024\"/><text x=\"355.0\" y=\"157\" text-anchor=\"middle\" class=\"ms\">Customer authenticates with their bank</text><line x1=\"250.0\" y1=\"196\" x2=\"46.0\" y2=\"196\" stroke=\"#6b7280\" stroke-width=\"1.6\" stroke-dasharray=\"5 4\"/><path d=\"M48.0 192 L40.0 196 L48.0 200 Z\" fill=\"#6b7280\"/><text x=\"145.0\" y=\"191\" text-anchor=\"middle\" class=\"ms\">agreement.activated webhook</text><line x1=\"40.0\" y1=\"230\" x2=\"244.0\" y2=\"230\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M242.0 226 L250.0 230 L242.0 234 Z\" fill=\"#1c2024\"/><text x=\"145.0\" y=\"225\" text-anchor=\"middle\" class=\"ms\">Create Charge under Agreement</text><line x1=\"250.0\" y1=\"264\" x2=\"46.0\" y2=\"264\" style=\"stroke:var(--bright)\" stroke-width=\"1.6\"/><path d=\"M48.0 260 L40.0 264 L48.0 268 Z\" style=\"fill:var(--bright)\"/><text x=\"145.0\" y=\"259\" text-anchor=\"middle\" class=\"ms\">Charge + status</text><line x1=\"250.0\" y1=\"298\" x2=\"46.0\" y2=\"298\" stroke=\"#6b7280\" stroke-width=\"1.6\" stroke-dasharray=\"5 4\"/><path d=\"M48.0 294 L40.0 298 L48.0 302 Z\" fill=\"#6b7280\"/><text x=\"145.0\" y=\"293\" text-anchor=\"middle\" class=\"ms\">charge.captured webhook</text></svg>",
    "endpoints": [
      "POST /v4/payment-agreements",
      "GET /v4/payment-agreements/{agreement_id}",
      "POST /v4/payment-agreements/{agreement_id}/payment-charges",
      "POST /v4/payment-agreements/{agreement_id}/pauses",
      "POST /v4/payment-agreements/{agreement_id}/resumptions",
      "POST /v4/payment-agreements/{agreement_id}/revocations"
    ],
    "links": [
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/set-up-recurring-payments",
        "label": "Set up recurring payments"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/getting-started-with-payments",
        "label": "Payments overview"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/payment-webhooks",
        "label": "Payment webhooks"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/docs/errors-and-troubleshooting",
        "label": "Errors and troubleshooting"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentagreement",
        "label": "API reference: Payment Agreements"
      },
      {
        "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/postoauth2token",
        "label": "API reference: Authentication"
      }
    ],
    "note": ""
  },
  "pay": {
    "title": "Payouts",
    "sub": "Server-to-server outbound transfers to UAE bank accounts. No customer-facing screen.",
    "pre": [
      "Authenticate with the Lean API.",
      "Fund the payout account.",
      "Configure payout lifecycle webhooks."
    ],
    "steps": [
      "Create the payout destination: <code>POST /payouts/v1/payment/destinations</code> with the beneficiary's details.",
      "Create the payout: <code>POST /payouts/v1/payment</code> with an idempotency key so retries never double-pay.",
      "Treat webhooks as the source of truth for the payout lifecycle, and handle failed-payout retries explicitly.",
      "Test in Sandbox: a successful payout, a failed payout and retry, and duplicate webhooks."
    ],
    "svg": "<svg class=\"seqsvg\" viewBox=\"0 0 500 208\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\"><style>.lb{font:700 11.5px Arial,Helvetica,sans-serif;fill:#1c2024}.ms{font:500 10.5px Arial,Helvetica,sans-serif;fill:#1c2024}.mm{font:italic 500 10.5px Arial,Helvetica,sans-serif;fill:#6b7280}</style><line x1=\"40.0\" y1=\"34\" x2=\"40.0\" y2=\"198\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"-12.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"40.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Wise backend</text><line x1=\"250.0\" y1=\"34\" x2=\"250.0\" y2=\"198\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"198.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"250.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Lean</text><line x1=\"460.0\" y1=\"34\" x2=\"460.0\" y2=\"198\" stroke=\"#e5e7eb\" stroke-width=\"1.5\"/><rect x=\"408.0\" y=\"6\" width=\"104\" height=\"22\" rx=\"7\" fill=\"#f3f4f6\" stroke=\"#e5e7eb\"/><text x=\"460.0\" y=\"21\" text-anchor=\"middle\" class=\"lb\">Bank rails</text><line x1=\"40.0\" y1=\"60\" x2=\"244.0\" y2=\"60\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M242.0 56 L250.0 60 L242.0 64 Z\" fill=\"#1c2024\"/><text x=\"145.0\" y=\"55\" text-anchor=\"middle\" class=\"ms\">Create payout destination</text><line x1=\"40.0\" y1=\"94\" x2=\"244.0\" y2=\"94\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M242.0 90 L250.0 94 L242.0 98 Z\" fill=\"#1c2024\"/><text x=\"145.0\" y=\"89\" text-anchor=\"middle\" class=\"ms\">Create payout  (POST /payouts/v1/payment)</text><line x1=\"250.0\" y1=\"128\" x2=\"454.0\" y2=\"128\" stroke=\"#1c2024\" stroke-width=\"1.6\"/><path d=\"M452.0 124 L460.0 128 L452.0 132 Z\" fill=\"#1c2024\"/><text x=\"355.0\" y=\"123\" text-anchor=\"middle\" class=\"ms\">Funds dispatched to beneficiary account</text><line x1=\"250.0\" y1=\"162\" x2=\"46.0\" y2=\"162\" stroke=\"#6b7280\" stroke-width=\"1.6\" stroke-dasharray=\"5 4\"/><path d=\"M48.0 158 L40.0 162 L48.0 166 Z\" fill=\"#6b7280\"/><text x=\"145.0\" y=\"157\" text-anchor=\"middle\" class=\"ms\">Payout lifecycle webhooks</text></svg>",
    "endpoints": [
      "POST /payouts/v1/payment/destinations",
      "POST /payouts/v1/payment"
    ],
    "links": [],
    "note": "Existing payout endpoints remain supported as the v4 payout surface rolls out."
  }
};

// Lean's v4 API reference, grouped as in the docs. Shown as an "API reference" block in the
// Launch Plan of blueprints that include a v4 payments product.
export const API_REFERENCE = [
  {
    "group": "Authentication",
    "resources": [
      {
        "name": "Authentication",
        "items": [
          {
            "method": "POST",
            "name": "Generate Access Token",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/postoauth2token"
          }
        ]
      }
    ]
  },
  {
    "group": "Payments",
    "resources": [
      {
        "name": "Payment Instruments",
        "items": [
          {
            "method": "POST",
            "name": "Create Payment Instrument",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentinstrument"
          },
          {
            "method": "GET",
            "name": "Fetch Payment Instrument",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getpaymentinstrument"
          },
          {
            "method": "PATCH",
            "name": "Update Payment Instrument",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/updatepaymentinstrument"
          }
        ]
      },
      {
        "name": "Payment Charges",
        "items": [
          {
            "method": "POST",
            "name": "Create Payment Charge",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentcharge"
          },
          {
            "method": "GET",
            "name": "Fetch Payment Charge",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getpaymentcharge"
          },
          {
            "method": "GET",
            "name": "List Captures",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/listcaptures"
          },
          {
            "method": "GET",
            "name": "Fetch Capture",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getcapture"
          }
        ]
      },
      {
        "name": "Payment Agreements",
        "items": [
          {
            "method": "POST",
            "name": "Create Payment Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentagreement"
          },
          {
            "method": "GET",
            "name": "Fetch Payment Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getpaymentagreement"
          },
          {
            "method": "POST",
            "name": "Create Charge Under Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createagreementcharge"
          },
          {
            "method": "GET",
            "name": "List Charges Under Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/listagreementcharges"
          },
          {
            "method": "POST",
            "name": "Pause Payment Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/pausepaymentagreement"
          },
          {
            "method": "GET",
            "name": "List Agreement Pauses",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/listagreementpauses"
          },
          {
            "method": "GET",
            "name": "Fetch Agreement Pause",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getagreementpause"
          },
          {
            "method": "POST",
            "name": "Resume Payment Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/resumepaymentagreement"
          },
          {
            "method": "GET",
            "name": "List Agreement Resumptions",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/listagreementresumptions"
          },
          {
            "method": "GET",
            "name": "Fetch Agreement Resumption",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getagreementresumption"
          },
          {
            "method": "POST",
            "name": "Revoke Payment Agreement",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/revokepaymentagreement"
          },
          {
            "method": "GET",
            "name": "List Agreement Revocations",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/listagreementrevocations"
          },
          {
            "method": "GET",
            "name": "Fetch Agreement Revocation",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getagreementrevocation"
          }
        ]
      }
    ]
  },
  {
    "group": "Core resources",
    "resources": [
      {
        "name": "Customer",
        "items": [
          {
            "method": "GET",
            "name": "List Customers",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getcustomers"
          },
          {
            "method": "POST",
            "name": "Create Customer",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/createcustomer"
          },
          {
            "method": "PUT",
            "name": "Update Customer",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/updatecustomer"
          },
          {
            "method": "GET",
            "name": "Get Customer by ID",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getcustomerbyid"
          },
          {
            "method": "GET",
            "name": "Get Customer by app_user_id",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getcustomerbyuserid"
          }
        ]
      },
      {
        "name": "Banks",
        "items": [
          {
            "method": "GET",
            "name": "List Banks",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getbanks"
          }
        ]
      },
      {
        "name": "Events",
        "items": [
          {
            "method": "GET",
            "name": "Get all Events",
            "url": "https://docs.leantech.me/v4.0-GLOBAL/reference/getevents"
          }
        ]
      }
    ]
  }
];
export const API_REFERENCE_PRODUCTS = ['otp', 'rec', 'cmi', 'namematch'];

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

// What the admin form needs (no panel HTML).
export function productSummaries() {
  return PRODUCTS.map(({ id, name, sub, card, apis, apiNote, effort, panel, linkFromDesign, toBeScoped, showCard }) =>
    ({ id, name, sub, card, apis, apiNote, effort, hasGuide: !!panel, linkFromDesign: linkFromDesign || '', toBeScoped: !!toBeScoped, showCard: showCard !== false }));
}
