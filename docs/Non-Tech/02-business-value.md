# Business Value

## The Problem, in Plain Terms

Imagine a customer taps "Pay $50" on a slow connection. The request goes out, but the confirmation never comes back before their app gives up and shows a "Something went wrong, try again" message. They tap "Pay $50" again.

Did they just pay $100? A well-built payment system says no — it recognizes the second tap as "the same attempt at the same payment," not a new one, and simply returns the same result both times. A poorly-built one either charges twice, or crashes and leaves the merchant unsure whether the money moved at all.

This project is about building — and *proving* — the "says no" version.

## Why This Matters to a Business

- **Customer trust**: a single double-charge, especially one that requires a support ticket and a manual refund to fix, does outsized damage to trust compared to almost any other kind of bug.
- **Financial exposure**: duplicate charges are real money moving incorrectly, not just a cosmetic error. At scale, even a rare failure rate translates into real disputed charges and chargeback fees.
- **Regulatory/compliance expectation**: payment processors are expected to demonstrate this kind of correctness, not just assert it. This project models what that evidence-backed approach looks like.

## What Sets This Apart From "It Works On My Machine"

Most software is tested by checking that it behaves correctly when used the way it's expected to be used. This project goes further: it deliberately tries to break its own safety mechanism by firing many duplicate requests at once, on purpose, and checks — with real measurements, not assumptions — that the system still behaves correctly under that stress.

The result: a documented, reproducible demonstration that under 10 simultaneous duplicate payment attempts, the fixed system gave every single customer a correct, definitive answer, while the original (unfixed) approach would have left 9 out of 10 of them stuck with an error instead of an answer — even though, in both cases, only one actual charge ever occurred.

## Where the Platform Stands Today

**Built and working**: account management, the full payment lifecycle, a management dashboard, security controls (login, permissions, request signing), monitoring dashboards, and automated tests that run on every change.

**Deliberately not built yet** (documented, not hidden): background job processing for scaling to very high volume, automatic webhook notifications to merchants' own systems, and a caching layer for extreme read traffic. These are natural next steps, not oversights — see [`06-project-status-roadmap.md`](06-project-status-roadmap.md).
