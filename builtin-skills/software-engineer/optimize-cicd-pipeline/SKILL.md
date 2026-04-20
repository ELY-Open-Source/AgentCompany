---
name: optimize-cicd-pipeline
description: Analyzes CI/CD pipelines to identify common antipatterns (like slow feedback loops or sequential steps) and recommends best practice patterns (like build images, parallelization, and build-once-deploy-anywhere). Use when designing, auditing, or troubleshooting CI/CD workflows to improve speed and reliability.
---

# Optimize CI/CD Pipeline

This skill provides a framework for auditing and improving CI/CD pipelines. The primary goal of any pipeline optimization is to **shorten the feedback loop**. The faster a developer knows something is wrong, the cheaper it is to fix.

## Usage Instructions

When analyzing a pipeline configuration or advising on DevOps practices, compare the user's current setup against the Antipatterns below. If an antipattern is detected, recommend the corresponding Pattern.

### 1. Core Philosophy Checklist
- [ ] **Feedback Loop**: Is the time from "commit" to "failure notification" under 10 minutes?
- [ ] **Reproducibility**: Can a developer run the exact same build command locally?
- [ ] **Maintenance**: Is the pipeline treated as a software product (versioned, refactored, maintained)?

### 2. Pattern Analysis

Use this table to diagnose issues and prescribe solutions:

| Detection (Antipattern) | Solution (Pattern) | Implementation Advice |
| :--- | :--- | :--- |
| **Installing tools on every run**<br>Build logs show repeated `npm install`, `apt-get install`, or downloading CLI tools. | **Use Build Images** | Pre-bake all dependencies into a Docker image. Use this image as the build agent/runner so the environment is instant. |
| **Sequential Steps**<br>Test, Lint, and Build run one after another. Total time = Sum of all steps. | **Parallelization (Fan-out)** | Run independent tasks simultaneously. Total time = Length of the slowest task. |
| **Rebuilding per Environment**<br>Code is compiled separately for "Test", "Staging", and "Prod". | **Build Once, Deploy Anywhere** | Build a single binary/artifact at the start. Promote that exact artifact through all environments to ensure consistency. |
| **Publishing on every run**<br>Artifact repository is flooded with broken or untested builds. | **Publish on Success** | Only push artifacts to the registry after all quality gates (linting, testing) have passed. |
| **Slow Feedback / Late Failures**<br>Syntax errors or linting issues are caught at the end of a long build. | **Fail Fast** | Reorder steps: Run the fastest checks (linting, unit tests) first. Do not run expensive integration tests if basic checks fail. |
| **"Works on My Machine"**<br>Pipeline fails but local build succeeds (or vice versa). | **Pipeline as Code** | Define infrastructure in code (Dockerfiles, YAML). Ensure local scripts match pipeline commands exactly. |

## Common Recommendations

1. **Target Time**: If a pipeline takes >15 minutes, productivity drops due to context switching. Aggressively optimize parallelization.
2. **Environment Consistency**: Never allow the CI server environment to drift from the developer's local environment.
3. **Drafting Pipelines**: Always start by defining the "Happy Path" (success state), then add the necessary gates to protect it.
