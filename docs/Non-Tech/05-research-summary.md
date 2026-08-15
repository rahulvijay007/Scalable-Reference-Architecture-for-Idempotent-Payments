# Research Summary (Plain Language)

This project doubles as a piece of original research, written up formally under the title *"A Scalable Reference Architecture for Idempotent Payment Processing: Design, Security, and Observability in a Full-Stack Implementation."* This page explains the finding without technical jargon. For the full technical version, see `research/` at the repo root.

## The Question

When many people try to pay at the exact same instant using what looks like the same payment attempt (say, because a shaky connection caused a retry), how do you guarantee:
1. The customer is never charged twice, **and**
2. Every single one of those people gets a clear, correct answer — not a confusing error?

## What Was Found

The original approach to this problem had a hidden flaw. It correctly prevented the double-charge (point 1) — but under the right unlucky timing, it failed at point 2: some customers would get a crash instead of an answer, even though their money was actually safe.

This is a subtle distinction that's easy to miss: **"never lose the customer's money" and "always tell the customer clearly what happened" are two different guarantees**, and a system can satisfy the first while failing the second.

## The Fix

A corrected approach was designed that guarantees both properties at once, with no meaningful added cost. A second, alternative fix using a different technique (a "lock," borrowing an idea similar to how a single-occupancy restroom works — only one person in, everyone else waits their turn) was also built, purely so the two approaches could be fairly compared.

## The Proof

Rather than just asserting the fix works, it was checked two ways:

1. **A logical argument** — walking through every possible sequence of events and showing the fix always produces a correct, definitive outcome.
2. **A real experiment** — actually firing many duplicate payment attempts at the system simultaneously and recording what happened.

The experiment's result, exactly matching the logical argument:

| Approach | Customers whose money was safe | Customers who got a clear answer |
|---|:---:|:---:|
| Original (flawed) | 10 out of 10 | **1 out of 10** |
| Fixed | 10 out of 10 | 10 out of 10 |

In other words: money was never actually at risk in either version — but 9 out of 10 customers using the original approach would have been left confused by an error message for no real reason, every single time this exact timing occurred.

## Why a Second Bug Was Found *While Fixing the First*

During the process of rigorously testing the fix (not just eyeballing it), a second, even subtler timing issue was discovered: a very fast follow-up request could, in rare cases, still hit a rough edge in the first fix. This was traced down and closed too. This is itself part of the research finding: it demonstrates the value of testing a fix with the same rigor as finding the original bug, rather than treating a fix as automatically finished once it "looks right."

## What This Contributes

This isn't just "a bug got fixed." It's a documented, reusable pattern — with a proof, a working reference implementation, and real measured evidence — for a problem every real payment system has to solve. It also honestly documents where this approach's own limits are (for example, the alternative "lock" approach has a known weakness if the lock is held too long), rather than overstating what was proven.
