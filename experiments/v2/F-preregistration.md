# Experiment F (pilot) — pre-registration

Written 2026-11-24 before launching any run.

- Tasks: f1 (PNG detection on Python 3.11 + 3.13), f2 (TS parameter properties under Node 22/24 type stripping), f3 (JSON import assertion on Node 22/24).
- Arms: `control` (task only) vs `cafe` (task + 4 capsules in ./cafe/: 1 relevant, 1 related/outdated, 2 distractors).
- Agent: one fresh general-purpose sub-agent per cell, same prompt template, same model (session default), same container, no network for the task.
- n = 1 per cell (6 runs). This is a pilot: it cannot show significance.
- Primary metric: first submission passes the capsule's check on every target runtime (graded by us after the agent finishes, agent never sees the grader).
- Secondary: commands the agent reports running (self-report), wall-clock minutes from launch to completion notification (coarse), whether the agent verified on the target runtimes.
- Decision rule (from the mandate): +10 pp first-attempt success or -15% median time to correct completion would justify continuing. With n=1 per cell we will only report direction and explicitly call it inconclusive.
- Known confounds: agents can read other directories in the container (the capsule repo exists on disk); the model likely knows these well-documented fixes (ceiling effect).
