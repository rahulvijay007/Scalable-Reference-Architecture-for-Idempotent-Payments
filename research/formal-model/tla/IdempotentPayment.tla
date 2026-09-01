---------------------------- MODULE IdempotentPayment ----------------------------
(*
  Machine-checked model of the idempotent-authorization protocol described in
  ../idempotency-protocol.md, covering the two production-relevant strategies:

    "Naive"       - read-then-insert with no handling of the UNIQUE-constraint
                     violation raised when a concurrent duplicate wins the race.
    "Optimistic"  - read-then-insert, catch the constraint violation, re-read
                     and reconcile against the winner (the production default,
                     IDEMPOTENCY_STRATEGY=optimistic).

  A single shared idempotency key is modeled (the interesting case is always
  N requesters racing on the SAME key - distinct keys never interact, since
  every action below is scoped to the one row this spec tracks). Requesters
  is the set of concurrent callers presenting that key.

  This is deliberately a small, checkable abstraction of the real system, not
  a re-implementation of it: it captures exactly the two events that decide
  the properties in question (the read of row-existence, and the atomic
  insert-or-fail against the database's UNIQUE constraint) and abstracts
  away everything the proof in idempotency-protocol.md §3-4 argues is
  irrelevant to Safety/Liveness (gateway calls, HTTP status codes, Redis).

  Run with (from this directory):
    java -jar tla2tools.jar -config IdempotentPayment_Naive.cfg IdempotentPayment.tla
    java -jar tla2tools.jar -config IdempotentPayment_Optimistic.cfg IdempotentPayment.tla

  See ../../REPRODUCE.md for the exact commands and the recorded TLC output.
*)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Requesters,   \* the set of concurrent callers racing on one shared idempotency key
  Strategy      \* "Naive" or "Optimistic"

VARIABLES
  rowExists,    \* whether the Payment row for the shared key has been created
  pc,           \* [Requesters -> control state]
  outcome       \* [Requesters -> final outcome, once pc[r] = "done"]

vars == <<rowExists, pc, outcome>>

PCStates == {"start", "sawExisting", "sawAbsent", "conflict", "done"}
Outcomes == {"none", "authorized", "reconciled", "unhandledError"}

TypeOK ==
  /\ rowExists \in BOOLEAN
  /\ pc \in [Requesters -> PCStates]
  /\ outcome \in [Requesters -> Outcomes]

Init ==
  /\ rowExists = FALSE
  /\ pc = [r \in Requesters |-> "start"]
  /\ outcome = [r \in Requesters |-> "none"]

(* SELECT Payment WHERE idempotencyKey = k -- reads the row's current existence *)
Read(r) ==
  /\ pc[r] = "start"
  /\ pc' = [pc EXCEPT ![r] = IF rowExists THEN "sawExisting" ELSE "sawAbsent"]
  /\ UNCHANGED <<rowExists, outcome>>

(* Row already existed at read time: reconcile immediately, no insert attempted. *)
ReconcileExisting(r) ==
  /\ pc[r] = "sawExisting"
  /\ outcome' = [outcome EXCEPT ![r] = "reconciled"]
  /\ pc' = [pc EXCEPT ![r] = "done"]
  /\ UNCHANGED rowExists

(* INSERT Payment (idempotencyKey = k, ...) -- atomic w.r.t. the UNIQUE constraint.
   Succeeds iff no row exists at the instant this action fires; the database
   guarantees this check-and-set is atomic regardless of how many requesters
   raced to this point, which is exactly the property the safety argument in
   idempotency-protocol.md leans on. *)
InsertAttempt(r) ==
  /\ pc[r] = "sawAbsent"
  /\ IF ~rowExists
       THEN /\ rowExists' = TRUE
            /\ outcome' = [outcome EXCEPT ![r] = "authorized"]
            /\ pc' = [pc EXCEPT ![r] = "done"]
       ELSE /\ UNCHANGED rowExists
            /\ pc' = [pc EXCEPT ![r] = "conflict"]
            /\ UNCHANGED outcome

(* Naive protocol: the P2002/23505 unique-violation is never caught, so it
   propagates as an unhandled exception -> opaque 500. This is the bug. *)
HandleConflictNaive(r) ==
  /\ Strategy = "Naive"
  /\ pc[r] = "conflict"
  /\ outcome' = [outcome EXCEPT ![r] = "unhandledError"]
  /\ pc' = [pc EXCEPT ![r] = "done"]
  /\ UNCHANGED rowExists

(* Optimistic-retry: catch the violation, re-SELECT. By the time we reach
   "conflict" a row is guaranteed to exist (that's precisely why the insert
   failed), so the re-read always finds a winner to reconcile against. *)
HandleConflictOptimistic(r) ==
  /\ Strategy = "Optimistic"
  /\ pc[r] = "conflict"
  /\ outcome' = [outcome EXCEPT ![r] = "reconciled"]
  /\ pc' = [pc EXCEPT ![r] = "done"]
  /\ UNCHANGED rowExists

(* Standard TLA+ idiom: once every requester has reached a terminal state,
   the only enabled action is to stutter. Without this, TLC reports every
   fully-terminated behavior as a "deadlock" even though termination is the
   correct, intended outcome - this action is what lets AllTerminate be
   checked as a liveness property instead of TLC treating termination itself
   as an error. *)
Terminating ==
  /\ \A r \in Requesters : pc[r] = "done"
  /\ UNCHANGED vars

Next ==
  \E r \in Requesters:
    \/ Read(r)
    \/ ReconcileExisting(r)
    \/ InsertAttempt(r)
    \/ HandleConflictNaive(r)
    \/ HandleConflictOptimistic(r)
  \/ Terminating

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

-----------------------------------------------------------------------------
(* Properties checked by TLC - see ../../REPRODUCE.md for the recorded results. *)

(* SAFETY - at most one requester is ever the row's creator, for either
   strategy (the naive/optimistic split only affects how the LOSERS are
   handled, never the database-enforced uniqueness itself). *)
Safety == Cardinality({r \in Requesters : outcome[r] = "authorized"}) <= 1

(* LIVENESS - every requester eventually reaches a terminal state. *)
AllTerminate == <>(\A r \in Requesters : pc[r] = "done")

(* LIVENESS (the property the naive protocol violates) - no requester ever
   terminates with an unhandled error. This is expected to FAIL under
   Strategy = "Naive" and HOLD under Strategy = "Optimistic" - TLC finding
   a counterexample for the former is not a spec bug, it is the formal
   restatement of the race condition fixed in idempotency-protocol.md. *)
NoUnhandledError == [](\A r \in Requesters : outcome[r] # "unhandledError")

=============================================================================
