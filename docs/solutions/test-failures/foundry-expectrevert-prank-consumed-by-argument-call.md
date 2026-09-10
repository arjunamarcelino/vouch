---
title: "Foundry test fails ('next call did not revert' or wrong AccessControl account) — vm.expectRevert/vm.prank consumed by an external call in the arguments"
category: test-failures
tags: [foundry, forge, solidity, testing, vm-expectrevert, vm-prank, cheatcodes, access-control]
module: packages/contracts
symptom: "`[FAIL: next call did not revert as expected]` on a call you know reverts, OR `AccessControlUnauthorizedAccount(<test contract>, ...)` with the wrong account instead of the pranked caller"
root_cause: "vm.expectRevert and vm.prank apply to the NEXT external call. An external call placed in the arguments (e.g. hub.MAX_COVERAGE(), hub.ROLE()) executes first and consumes the cheatcode, so it lands on the view call, not the intended one"
date: 2026-09-10
---

# Foundry: vm.expectRevert / vm.prank consumed by an external call in the arguments

## Symptom

Two flavors, both on tests that look obviously correct:

1. **`[FAIL: next call did not revert as expected]`** on a call you can prove reverts:
   ```solidity
   vm.prank(client);
   vm.expectRevert(Errors.CoverageTooLong.selector);
   hub.openJob(provider, address(usdc), TASK_FEE, GUARANTEE, SERVICE_FEE,
       deadline, hub.MAX_COVERAGE() + 1, PUBLIC_HASH, PRIVATE_COMMIT); // should revert, but "did not revert"
   ```

2. **Wrong account in a parameterized revert** — the expected/actual differ only in the address:
   ```
   AccessControlUnauthorizedAccount(0x7FA9...<test contract>, 0x48...ROLE)
     != AccessControlUnauthorizedAccount(0x9dF0...<attacker>, 0x48...ROLE)
   ```
   ```solidity
   vm.prank(attacker);
   vm.expectRevert(abi.encodeWithSelector(
       IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, hub.EVALUATOR_ROLE()));
   hub.resolveInitialEvaluation(jobId, true); // ran as the TEST CONTRACT, not `attacker`
   ```

## Root cause

`vm.expectRevert(...)` and `vm.prank(...)` each apply to **the very next external call**. Neither
is itself a call. But an **external call written in the arguments** of the target statement is
evaluated **first** — so it becomes "the next call" and **consumes** the cheatcode:

- Case 1: `hub.MAX_COVERAGE()` (a `view` external call) is evaluated to build the `openJob` args. It
  is the next call after `vm.expectRevert`, it returns successfully → `expectRevert` sees a
  non-reverting call → "next call did not revert." `openJob` then runs *unguarded*.
- Case 2: `hub.EVALUATOR_ROLE()` is evaluated (after `vm.prank(attacker)`) to build the
  `expectRevert` arg. It consumes the prank, so `resolveInitialEvaluation` runs as the default test
  contract (`address(this)` = `0x7FA9…`), not `attacker`.

This is subtle because the offending call is a public getter/constant that "feels" free.

## Investigation (what didn't work)

- Re-reading the contract's revert logic — the contract was correct; the bug was in the test harness.
- Assuming `vm.prank`/`vm.expectRevert` attach to the *statement* — they attach to the next **call**,
  and argument sub-calls count.

## Working solution

**Hoist every external call out of the arguments into locals BEFORE the cheatcode**, so the only
external call after `vm.prank`/`vm.expectRevert` is the intended one:

```solidity
// Case 1
uint64 tooLong = hub.MAX_COVERAGE() + 1;   // external call resolved first, into a local
uint64 deadline = uint64(block.timestamp) + SUBMIT_WINDOW;
vm.prank(client);
vm.expectRevert(Errors.CoverageTooLong.selector);
hub.openJob(provider, address(usdc), TASK_FEE, GUARANTEE, SERVICE_FEE, deadline, tooLong, ...);

// Case 2
bytes32 evRole = hub.EVALUATOR_ROLE();      // hoist so it can't consume the prank
vm.prank(attacker);
vm.expectRevert(abi.encodeWithSelector(
    IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, evRole));
hub.resolveInitialEvaluation(jobId, true);
```

Both then pass: the getter runs before the cheatcode, and the cheatcode lands on the intended call.

## Prevention

- **Rule of thumb:** the statement right after `vm.prank`/`vm.expectRevert` must contain **no other
  external call** — not even a `view` getter or a `constant()` accessor. Precompute args into locals.
- Applies equally to `vm.startPrank` if the first thing inside is an argument sub-call.
- Prefer `abi.encodeWithSelector(Err.selector, ...)` args built from **local variables**, never from
  inline `contract.getter()` calls.
- When a revert test mysteriously "did not revert," or an `AccessControl`/parameterized error differs
  only by address, suspect a consumed cheatcode before suspecting the contract.
- Constants exposed as `public constant` are still **external calls** from a test's perspective
  (`hub.MAX_COVERAGE()`); reference the value via a local or a test-side constant.

## Cross-references

- Fixed in `packages/contracts/test/AssuranceHub.neg.t.sol` (`test_CoverageTooLong_Reverts`,
  `test_CoverageTooShort_Reverts`, `test_UnauthorizedEvaluator_Reverts`).
- Foundry Book: cheatcodes — `expectRevert`, `prank` (each affects the next call only).
- Related: `docs/solutions/build-errors/graph-cli-assemblyscript-compiler-crash-nullable-fields.md`.
