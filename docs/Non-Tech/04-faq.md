# Frequently Asked Questions

## Is this a real payment processor, connected to real banks/card networks?

No. It uses a realistic *simulated* payment gateway (configurable success rate and latency) so the platform's own logic — authentication, permissions, the payment lifecycle, and especially the duplicate-payment protection — can be built and tested exactly as it would be in production, without needing a real bank integration or handling real card data.

## What's the single most important thing this project demonstrates?

That a subtle but real bug — one that would let a customer get double-charged, or at least get an unhelpful crash instead of a clear answer, under unlucky timing — was found, fixed, and the fix was *proven* correct with both a logical argument and real measured evidence, not just "it passed the tests I happened to write."

## What does "the fix was proven correct" actually mean?

Two things, together: (1) a written argument, following standard practice for reasoning about concurrent systems, showing why the fix always gives a correct outcome; and (2) an actual test where many duplicate requests were fired at the system at once and the real outcome was measured and recorded, confirming the argument matches reality.

## How is this different from normal software testing?

Normal testing checks: "does this work when used as intended?" This project additionally checks: "does this still work correctly under the specific, adversarial conditions most likely to break it?" — many simultaneous duplicate requests, tampered security signatures, and the like — deliberately, on purpose, with the results recorded rather than assumed.

## Is the code publicly available?

Yes — see [`05-research-summary.md`](05-research-summary.md) and the technical documentation's [architecture overview](../Tech/01-architecture-overview.md) for how to explore it.

## What technologies were used?

Backend: Node.js, TypeScript, Express, PostgreSQL. Frontend: Next.js (React), Material UI. Infrastructure: Docker, Prometheus/Grafana for monitoring. Full list in the [technical documentation](../Tech/README.md).

## Is this project finished?

The core platform and the duplicate-payment research are complete and verified. A few larger infrastructure pieces (background job processing, automatic merchant notifications) are intentionally left as documented future work rather than half-built — see [`06-project-status-roadmap.md`](06-project-status-roadmap.md).

## Who built this and how?

A solo project, built with AI-assisted development (Claude Code) working alongside the project owner across the full lifecycle: implementation, security hardening, testing, and the research/verification work described here.
