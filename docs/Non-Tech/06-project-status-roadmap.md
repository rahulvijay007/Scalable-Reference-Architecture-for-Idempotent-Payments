# Project Status & Roadmap

## What's Complete

- **Core platform**: user/merchant accounts, secure login, role-based permissions, and the full payment lifecycle (charge → hold → capture → refund → cancel).
- **Web dashboard**: a working interface to log in, create payments, and manage them, plus a self-service page for merchants to issue their own programmatic access keys.
- **Security hardening**: layered authentication, permission checks, optional request-signing, and safeguards so sensitive card data is never stored or logged.
- **Automated testing**: a full suite of automated checks — including tests specifically designed to try to break the system's security and correctness guarantees — that run automatically on every code change.
- **Monitoring**: live dashboards showing system health and payment success/failure rates in real time.
- **The research work**: the duplicate-payment protection design, its proof, and the experiments validating it (see [`05-research-summary.md`](05-research-summary.md)) — complete, documented, and reproducible.

## What's Intentionally Not Built Yet

These are documented, deliberate scope decisions — not gaps that were missed:

- **Background/asynchronous processing**: today, every payment operation completes within a single request-response cycle. At very high volume, a real platform would move some of this work to background processing to keep response times low. The infrastructure for this is provisioned but not yet wired into the application.
- **Automatic merchant notifications ("webhooks")**: the data model for notifying a merchant's own system when a payment's status changes exists, but the delivery mechanism itself isn't built yet.
- **Response caching**: not yet needed at this scale; the groundwork exists.

## Natural Next Steps

1. Wire up background processing for payment operations, to prepare for higher transaction volume.
2. Build the merchant-notification delivery system.
3. Add deployment configuration for running the platform on a container orchestration platform (e.g., Kubernetes) at scale.
4. Expand the research into a submission-ready paper for a relevant academic venue, using the existing formal argument and experimental results as its foundation.

## A Note on How This Was Built

This project was developed with AI-assisted engineering (Claude Code), working iteratively with the project owner: first building the platform, then hardening it for production-quality concerns (security, testing, observability), and finally converting the strongest technical finding into a rigorously validated piece of research. Every claim in the research writeup is backed by an actual, reproducible experiment recorded in the repository — nothing is asserted without evidence.
