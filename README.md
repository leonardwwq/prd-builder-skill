[English](README.md) | [简体中文](README.zh-CN.md)

# PRD Builder

**An adaptive, token-efficient Agent Skill for turning product ideas into implementation-ready PRDs.**

PRD Builder helps AI coding agents transform product requirements into structured, actionable Product Requirements Documents (PRDs) without forcing every task through the same heavyweight workflow.

It adapts the planning process to the complexity of the task: lightweight for small changes, more structured for complex features, and coordinated multi-role workflows for larger projects.

The goal is simple: **spend tokens where they improve requirements quality, not on unnecessary process overhead.**

## Why PRD Builder?

A common problem with AI-assisted product development is that planning workflows can be as expensive as the implementation itself.

A small requirement change may trigger extensive context loading, multiple review rounds, parallel agent coordination, and a large collection of generated documents. This can improve coverage for complex projects, but it also adds latency and token costs to straightforward tasks.

PRD Builder addresses this by making the workflow proportional to the task.

- **Adaptive complexity** — Select a workflow based on scope, state changes, risk, collaboration needs, and maintenance implications.
- **Token-efficient context loading** — Read only the instructions, references, and project materials relevant to the current task.
- **Quality without unnecessary ceremony** — Keep essential requirement checks while avoiding heavyweight coordination for simple work.
- **Project-aware specifications** — Account for existing conventions, dependencies, permissions, edge cases, and implementation constraints.
- **Resumable work** — Maintain a concise working snapshot so an agent can continue without repeatedly reconstructing the entire project history.

## How It Works

PRD Builder supports three workflow modes.

| Mode | Best for | Approach |
|---|---|---|
| **Lite** | Small features, straightforward changes, focused modifications | Minimal context loading and a single PRD deliverable |
| **Standard** | Features involving meaningful trade-offs, state changes, or permissions | Additional requirement analysis and clarification where needed |
| **Project** | Large, cross-cutting, or multi-page projects | Coordinated roles, structured reviews, and broader project documentation |

The skill selects a starting mode based on task complexity. It can move to a more rigorous workflow when the task reveals additional risks or dependencies.

The objective is not to make every PRD shorter. It is to avoid paying the cost of a large planning process when the task does not need one.

## Token Efficiency

PRD Builder was benchmarked against its previous version using the same model, fictional project materials, and task prompts. Only the skill version changed.

### Benchmark results

| Task size | Input tokens | Output tokens | Execution time |
|---|---:|---:|---:|
| Small | −89% | −83% | −80% |
| Medium | −81% | −63% | −56% |
| Large | −20% | −7% | −12% |

*Results are from one run per task size. They are preliminary measurements, not guarantees of performance across models, projects, or agents.*

The largest gains came from straightforward tasks, where the previous workflow loaded many files and generated multiple artifacts that were not always necessary. Large projects benefited less because they still required substantial context, coordination, and documentation.

### What changed

- Replaced the mandatory heavyweight workflow with three complexity-aware modes.
- Reduced the main `SKILL.md` from approximately 18.7 KB to 12.9 KB.
- Made reference loading conditional on the task instead of reading broadly by default.
- Consolidated project-specific conventions into a single source of truth.
- Reworked working logs into compact snapshots with incremental change notes.
- Added quality checks for regression impact and idempotency/server-side validation of batch operations.

These changes target both token consumption and execution overhead while retaining the checks that matter for implementation quality.

## Quality Matters Too

Reducing token usage is only useful if the resulting PRD remains actionable.

In the initial blind reviews of the benchmark outputs, the new version scored:

| Task size | Previous version | New version |
|---|---:|---:|
| Small | 8.5/10 | 8/10 |
| Medium | 6.5/10 | 8.5/10 |
| Large | 6/10 | 9/10 |

The small-task result shows an important trade-off: a leaner workflow can omit details that a more comprehensive process might catch. The review also exposed gaps around default-value regressions and batch-operation safety, which were added to the quality checklist.

These scores are directional rather than conclusive. Each task was tested once, and reviewer scores can vary. More real-world usage is needed to evaluate consistency across different projects and agent environments.

## Installation

Clone the repository:

```bash
git clone https://github.com/leonardwwq/prd-builder-skill.git
```

Install the skill into your agent's skill directory. For example, in an environment using `~/.dsh/skills/`:

```bash
mkdir -p ~/.dsh/skills
cp -R prd-builder-skill ~/.dsh/skills/prd-builder
```

Follow the skill-loading conventions of your agent platform if they differ. If the repository contains a dedicated skill directory, copy that directory rather than the entire repository.

## Usage

Once installed and available to your agent, describe the requirement you want to turn into a PRD.

Examples:

**Small change**

```text
Use PRD Builder to specify a new filter on the campaign list.
Keep the scope narrow and account for existing behavior.
```

**Feature with trade-offs**

```text
Use PRD Builder to define a batch-editing feature for ad groups.
Clarify permission boundaries, validation rules, failure handling,
and the impact on existing workflows.
```

**Large project**

```text
Use PRD Builder to plan a multi-page feature involving campaign
configuration, reporting, and shared data models.
Identify cross-page dependencies and review the requirements
for contradictions before finalizing the PRD.
```

The agent should choose an appropriate workflow and produce the PRD artifacts required for the task.

## Design Principles

1. **Complexity should determine process.** Small tasks should not inherit the overhead of large projects.
2. **Context is a cost.** Load reference materials when they are relevant, not simply because they exist.
3. **Quality checks should be deliberate.** Prioritize checks that prevent implementation errors over repetitive procedural steps.
4. **Progress should be resumable.** Preserve decisions and unresolved questions without carrying the entire history forward.
5. **Measure actual outcomes.** Evaluate token usage, latency, omissions, and rework together rather than optimizing token counts in isolation.

## Limitations

- Token savings depend on task complexity, model behavior, agent implementation, and context-caching or billing policies.
- Complex projects still require substantial analysis and documentation.
- Benchmark results are preliminary and should not be treated as universal performance guarantees.
- The skill guides requirement analysis and document generation; it does not guarantee that generated requirements are correct or that subsequent code is production-ready.

## Roadmap

Areas for continued validation include:

- Real-world usage across different requirement types.
- Regression testing for existing-project modifications.
- More repeatable quality evaluations across task sizes.
- Better measurement of actual billed cost, latency, and downstream rework.

## Contributing

Issues, reproducible examples, and suggestions for improving the balance between PRD quality and execution cost are welcome.