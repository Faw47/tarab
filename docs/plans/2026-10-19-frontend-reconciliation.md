# Reconcile merged frontend findings and close residual defects

Base: PR #27 head `5f844a8e987019651628daf51fff6e58adc6e5e4`. Branch:
`chatgpt/remediation-frontend-reconciliation`.

1. Independently review FE-16, FE-17, FE-22, FE-26, FE-30 and FE-08 against the original audit
   and current tests. Keep FE-18 pending: shared Home data does not establish theme-wide feature parity.
2. Reproduce and correct discovered FE-16 focus retention and FE-22 direction/spacing omissions.
   Keep keyboard-focused Home volume controls expanded after pointer leave. Resolve direction on
   dynamic library, queue, album/player metadata and neo search. Isolate queue artist/album values.
   Dynamic neo text must use normal spacing even when Latin precedes Arabic.
3. Run focused regressions, complete frontend checks and independent re-review. Reconstruct older
   pre-fix source cases where practical to establish failing-before evidence for existing changes.
4. Reconcile ledger dispositions with explicit native acceptance gaps and publish a stacked draft.
   No merge or release; native window dragging, audio and WebView appearance remain unverified.
