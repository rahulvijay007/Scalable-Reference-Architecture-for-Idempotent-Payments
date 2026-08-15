# Project Overview

## What This Is

A complete, working payment-processing platform — the same kind of system a fintech company would build to let merchants accept, hold, and refund card payments — built end-to-end as both a demonstration of production-quality software engineering practice and a piece of original research.

Think of it like a simplified version of what Stripe or Adyen offer merchants: a way to charge a customer's card, hold that charge, release ("capture") the funds, and refund some or all of it later — done safely, securely, and in a way that's been proven to work correctly even when many things happen at once.

## Why It Exists

Payment systems have to get a specific, easy-to-underestimate problem right: **never charge someone twice by accident.** Networks are unreliable — a customer's "Pay Now" click can time out and get retried, a mobile app can lose signal mid-request and resend automatically, a server can crash after the money moved but before it confirmed. Every real payment platform has to handle this, and getting it wrong means double-charged customers, real financial harm, and lost trust.

This project builds, and then rigorously tests, a solution to exactly that problem.

## What Was Built

1. **A real payment platform**: user accounts, merchant accounts, secure login, a full payment lifecycle (charge → capture → refund → cancel), and a web dashboard to manage it all.
2. **A fix for a real bug**: while building it, a genuine flaw was found — under the right unlucky timing, two duplicate requests could crash instead of being handled gracefully. That bug was fixed, and the fix was proven correct rather than just "seeming to work."
3. **Proof it works, with numbers**: instead of just claiming the fix works, it was tested with real concurrent traffic and the results were measured and recorded — not simulated or assumed.

## Who Would Care

- **A hiring manager or technical reviewer** evaluating engineering depth — this shows not just "can build a CRUD app" but "can find and prove-fix a subtle concurrency bug."
- **An academic audience** — the project is written up as a research artifact with a formal correctness argument, a threat model, and reproducible experiments, suitable as the basis for a conference paper or thesis chapter.
- **Anyone building or evaluating a payment integration** — the design decisions and their tradeoffs are documented plainly, which is useful reference material regardless of whether this exact code is reused.

## How to Explore This Project

- Read [`02-business-value.md`](02-business-value.md) for what problem this solves in plain terms.
- Read [`05-research-summary.md`](05-research-summary.md) for the headline finding, explained without jargon.
- Read [`04-faq.md`](04-faq.md) for likely questions.
- For the technical deep-dive, see [`docs/Tech/`](../Tech).
