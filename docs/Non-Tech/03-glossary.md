# Glossary

Plain-language definitions of terms used throughout this project's documentation.

**API (Application Programming Interface)** — the set of rules a piece of software exposes so other software can talk to it. In this project, the backend's API is how the website (and any other client) creates and manages payments.

**Authentication** — proving who you are (logging in).

**Authorization** — once you're logged in, determining what you're *allowed* to do. Here: role-based, e.g. an admin can do more than a support agent.

**Authorize (payment)** — the first step of a card payment: checking the card is valid and reserving the funds, without yet taking the money. Like a hotel putting a hold on your card at check-in.

**Capture (payment)** — actually taking the previously-authorized funds. Like the hotel charging your card at check-out for the final amount.

**Concurrency** — multiple things happening at (or near) the same time. Most of this project's hardest problems come from concurrency: two requests arriving within milliseconds of each other.

**Database** — where the platform's data (accounts, payments, transaction history) is permanently stored. This project uses PostgreSQL, a widely-used open-source database.

**Idempotency / Idempotent** — a fancy word for "doing it more than once has the same effect as doing it once." Pressing an elevator call button five times doesn't call five elevators. An idempotent payment request behaves the same way.

**Idempotency Key** — a unique ID the customer's app attaches to a payment attempt. If the same key shows up twice, the system knows it's a retry of the same attempt, not a new payment.

**Latency** — how long a request takes to get a response. Lower is better.

**Merchant** — the business accepting payments through this platform (as opposed to the individual customer paying).

**Race Condition** — a bug that only happens because of unlucky timing between two things happening "at once." Notoriously hard to find because it doesn't happen every time — only when the timing lines up badly.

**Refund** — returning some or all of a captured payment back to the customer.

**RBAC (Role-Based Access Control)** — assigning permissions based on a person's role (Admin, Merchant, Developer, Support) rather than to each person individually.

**Repository / Repo** — the complete set of project files and their full history of changes, typically hosted on a platform like GitHub.

**Throughput** — how many requests a system can handle per second. Higher is better (up to the point where correctness or latency suffers).

**Token (JWT)** — a signed piece of digital proof, issued after login, that a request is coming from an authenticated, legitimate user.
