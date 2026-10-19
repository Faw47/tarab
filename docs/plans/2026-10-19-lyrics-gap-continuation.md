# Enhanced lyrics gaps and RAF evidence continuation

Base: PR #29 head 58f10e32e681635f240417058bf48788a5a322b5. Continue inline.

- [x] PB-27: reproduce enhanced empty line markers, word-only markers, late offsets and repeated
  line timestamps in the real parser/current-line resolver. Preserve empty lines with no words;
  retain existing nonempty enhanced-word timing and normalization. No native/network changes.
- [x] Run targeted red/green tests, complete frontend checks and independent parser re-review.
- [x] FE-42: reproduce the old always-running provider with current lifecycle tests, restore byte
  exact source, verify current provider tests. Record fresh independent G3 review and baseline CI.
- [x] Update ledger based on evidence; preserve native appearance/audio gaps separately from the
  deterministic parser and scheduling claims. Publish a separate stacked draft without merging.

Review focus: empty word arrays must not create invalid timestamps; word-only blanks need a real
start time; offsets apply globally to gaps; repeated line tags keep distinct markers; normalization
and current-line selection must retain the empty interval. FE-42 concerns paused/subscriber RAF
scheduling, not visibility throttling or audio synchronization.

Results: four parser failures reproduced then corrected; old provider failed all six lifecycle tests and was restored byte-exact. Current focused parser/provider suite: 17 passed. Complete frontend suite: 450 passed. Independent parser review clean, including nonempty baseline comparisons. No native source change.
