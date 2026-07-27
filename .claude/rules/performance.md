# Performance Optimization

## Model Selection Strategy

**Haiku** - Lightweight tasks:
- Frequent, simple agent invocations
- Straightforward code generation
- Worker agents in multi-agent systems

**Sonnet** - Standard development:
- Main development work
- Orchestrating multi-agent workflows
- Most coding tasks

**Opus** - Complex reasoning:
- Architectural decisions
- Difficult debugging
- Research and analysis

## Context Window Management

Avoid last 20% of context for:
- Large-scale refactoring
- Multi-file feature implementation
- Complex debugging sessions

Lower context sensitivity:
- Single-file edits
- Simple bug fixes
- Documentation updates
