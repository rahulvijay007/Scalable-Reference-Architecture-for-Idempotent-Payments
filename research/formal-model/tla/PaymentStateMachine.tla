---------------------------- MODULE PaymentStateMachine ----------------------------
(*
  Machine-checked model of the single-payment lifecycle described in
  ../payment-state-machine.md - the complete transition table in that
  document's Sec2, and the two invariants in its Sec3 (No-invalid-transition,
  Refund-sum invariant; the third invariant there, idempotency, is modeled
  separately in IdempotentPayment.tla).

  Unlike IdempotentPayment.tla (which models several requesters racing on
  ONE key), this spec models ONE payment's entire lifecycle end to end,
  including a bounded, nondeterministic gateway (success or failure on every
  capture/refund/cancel attempt, exactly as the real mock gateway is
  nondeterministic in research/benchmarks) and a nondeterministic partial-
  refund amount, so TLC's exhaustive search covers every reachable
  combination of outcomes and refund amounts up to MaxAmount, not just the
  one interleaving a hand-written test would think to exercise.

  Run with (from this directory):
    java -jar tla2tools.jar -config PaymentStateMachine.cfg PaymentStateMachine.tla

  See ../../REPRODUCE.md for the exact command and the recorded TLC output
  in tlc-output-payment-state-machine.txt.
*)
EXTENDS Naturals, FiniteSets

CONSTANTS
  MaxAmount   \* face amount of the payment being modeled (a small constant, e.g. 3, keeps the state space finite and exhaustively checkable)

VARIABLES
  status,         \* current PaymentStatus
  refundedAmount, \* sum of successful refunds so far, 0..MaxAmount
  prevStatus      \* status immediately before the current one - exists purely so the ValidTransition invariant below can check "every step taken is an edge in the documented transition table," which is the direct formalization of the No-invalid-transition claim in payment-state-machine.md Sec3

vars == <<status, refundedAmount, prevStatus>>

States == {"PENDING", "AUTHORIZED", "CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED", "CANCELLED"}
Terminal == {"REFUNDED", "FAILED", "CANCELLED"}

(* Every (from, to) pair the real service's guard conditions permit, taken
   directly from the transition table in payment-state-machine.md Sec2 -
   including "unchanged" self-loops for the documented failure paths
   (capture/refund/cancel failure leaves the payment in its prior state,
   per Sec4's second known gap). This set IS the transition table, restated
   as data instead of prose. *)
ValidEdges == {
  <<"PENDING", "AUTHORIZED">>,            \* createAndAuthorize success
  <<"PENDING", "FAILED">>,                \* createAndAuthorize failure
  <<"AUTHORIZED", "CAPTURED">>,           \* capture success
  <<"AUTHORIZED", "AUTHORIZED">>,         \* capture failure (unchanged)
  <<"CAPTURED", "REFUNDED">>,             \* refund (full) success
  <<"CAPTURED", "PARTIALLY_REFUNDED">>,   \* refund (partial) success
  <<"CAPTURED", "CAPTURED">>,             \* refund failure (unchanged)
  <<"PARTIALLY_REFUNDED", "REFUNDED">>,           \* refund (remaining) success
  <<"PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED">>, \* refund (further partial) success, or refund failure (unchanged)
  <<"PENDING", "CANCELLED">>,             \* cancel success (from PENDING)
  <<"AUTHORIZED", "CANCELLED">>,          \* cancel success (from AUTHORIZED)
  <<"PENDING", "PENDING">>,               \* cancel failure (unchanged)
  <<"AUTHORIZED", "AUTHORIZED">>          \* cancel failure (unchanged) - duplicate of capture-failure edge above, harmless in a set
}

TypeOK ==
  /\ status \in States
  /\ refundedAmount \in 0..MaxAmount
  /\ prevStatus \in States

Init ==
  /\ status = "PENDING"
  /\ refundedAmount = 0
  /\ prevStatus = "PENDING"  \* no real predecessor yet; the initial state trivially satisfies ValidTransition since <<"PENDING","PENDING">> is unreachable as an actual action but never checked before a first step

Authorize(success) ==
  /\ status = "PENDING"
  /\ prevStatus' = status
  /\ status' = IF success THEN "AUTHORIZED" ELSE "FAILED"
  /\ UNCHANGED refundedAmount

Capture(success) ==
  /\ status = "AUTHORIZED"
  /\ prevStatus' = status
  /\ status' = IF success THEN "CAPTURED" ELSE "AUTHORIZED"
  /\ UNCHANGED refundedAmount

(* amt is the amount being refunded in THIS call; nondeterministically
   ranges over every value that would pass the service's `amount <=
   remaining` guard, so TLC explores every possible partial-refund
   sequence up to MaxAmount, not just full or single-partial refunds. *)
Refund(amt, success) ==
  /\ status \in {"CAPTURED", "PARTIALLY_REFUNDED"}
  /\ amt \in 1..(MaxAmount - refundedAmount)
  /\ prevStatus' = status
  /\ IF success
       THEN /\ refundedAmount' = refundedAmount + amt
            /\ status' = IF refundedAmount' = MaxAmount THEN "REFUNDED" ELSE "PARTIALLY_REFUNDED"
       ELSE /\ UNCHANGED refundedAmount
            /\ status' = status

Cancel(success) ==
  /\ status \in {"PENDING", "AUTHORIZED"}
  /\ prevStatus' = status
  /\ status' = IF success THEN "CANCELLED" ELSE status
  /\ UNCHANGED refundedAmount

Terminating ==
  /\ status \in Terminal
  /\ UNCHANGED vars

Next ==
  \/ \E success \in BOOLEAN: Authorize(success)
  \/ \E success \in BOOLEAN: Capture(success)
  \/ \E amt \in 1..MaxAmount, success \in BOOLEAN: Refund(amt, success)
  \/ \E success \in BOOLEAN: Cancel(success)
  \/ Terminating

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

-----------------------------------------------------------------------------
(* Properties checked by TLC - see ../../REPRODUCE.md for the recorded results. *)

(* No-invalid-transition (payment-state-machine.md Sec3, item 1): every step
   this spec ever takes is an edge in the documented transition table.
   Checking this as an invariant over TLC's exhaustive search is a direct
   machine-checked version of the prose claim "no code path can move a
   payment directly between two states that aren't connected by a listed
   transition." *)
ValidTransition == <<prevStatus, status>> \in ValidEdges

(* Refund-sum invariant (payment-state-machine.md Sec3, item 2): the sum of
   successful refunds never exceeds the payment's face amount. TypeOK's
   0..MaxAmount range on refundedAmount already makes this true by
   construction of the variable's domain, so this invariant is restated
   explicitly and separately as the property actually being claimed, not
   merely relying on the type being well-formed to imply it. *)
RefundSumInvariant == refundedAmount <= MaxAmount

(* Terminal states really are terminal: once status is REFUNDED, FAILED, or
   CANCELLED, no action ever changes it again (only Terminating's stutter
   applies) - the direct formalization of the "Terminal?" column in
   payment-state-machine.md Sec1. *)
TerminalStaysTerminal == [](status \in Terminal => [](status \in Terminal))

=============================================================================
