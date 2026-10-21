// Starting content for the Verticals page, used once when the verticals table is empty.
// After that, the SE team maintains verticals in the admin page and these are not used again.
// Remittance comes from the Wise blueprint ("{client}" becomes the client's name). The other
// verticals start empty on purpose: their pain points should come from the team, not be made up here.
export const DEFAULT_VERTICALS = [
  {
    "id": "remittance",
    "name": "Remittance",
    "painIntro": "Bringing {client}'s product experience to the UAE means moving funding, recurring pulls and payouts onto local account-to-account infrastructure. These are the remittance pain points Lean addresses, split by business and technical impact.",
    "painRows": [
      {
        "group": "business",
        "pain": "Card fees erode thin margins on top-ups and collections.",
        "solve": "Lean **Pay by Bank** for bank-to-bank top-ups and collections as a lower-cost alternative to cards.",
        "advantage": "Lower take-rates, improved unit economics, and more pricing flexibility per corridor."
      },
      {
        "group": "business",
        "pain": "Volatile rates, spreads, and correspondent fees vary by corridor, squeezing competitiveness.",
        "solve": "Reduce card dependence and improve settlement predictability.",
        "advantage": "Higher, more stable margins per corridor through lower acceptance costs."
      },
      {
        "group": "technical",
        "pain": "Multiple payment methods and payout rails increase integration and ops complexity.",
        "solve": "A single integration for **Pay by Bank** and **Payouts**, with normalized references and clear statuses across banks.",
        "advantage": "Faster time-to-market and leaner operations, with less engineering effort and support load."
      },
      {
        "group": "technical",
        "pain": "Bank variability and inconsistent references make for a non-standard experience across banks and corridors.",
        "solve": "Consistent payment references across banks, handling different bank formats.",
        "advantage": "More predictable ops and faster exception handling across markets."
      },
      {
        "group": "technical",
        "pain": "Heavy AML / KYC expectations, especially source-of-funds and beneficiary ownership checks, add operational burden.",
        "solve": "Name verification on pay-ins, in development at Lean and targeted for Q4, will support payer screening and ownership checks.",
        "advantage": "Reduced manual document collection, better compliance posture, smoother UX."
      }
    ],
    "useCases": [
      "Wallet top-up",
      "Scheduled remittance",
      "Corridor payout"
    ]
  },
  {
    "id": "trading-gaming",
    "name": "Trading & Gaming",
    "painIntro": "",
    "painRows": [],
    "useCases": []
  },
  {
    "id": "lending",
    "name": "Lending",
    "painIntro": "",
    "painRows": [],
    "useCases": []
  },
  {
    "id": "emerging-industries",
    "name": "Emerging Industries",
    "painIntro": "",
    "painRows": [],
    "useCases": []
  }
];
