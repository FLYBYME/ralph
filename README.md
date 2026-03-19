# Ralph: The Autonomous AI Programming Agent

Ralph is a proactive, state-driven AI automation agent designed to act as a co-maintainer for your codebases. Unlike standard chat assistants, Ralph operates via a Finite State Machine (FSM), possesses persistent memory, and can autonomously find and fix issues while you sleep.

---

## 🏗 High-Level Architecture

Ralph is built on a modular, event-driven architecture that separates high-level orchestration from low-level execution.

-   **DaemonOrchestrator**: The heartbeat of the system. It monitors the task queue, manages the FSM lifecycle, and triggers proactive maintenance when the system is idle.
-   **Finite State Machine (FSM)**: Manages tasks through distinct, verifiable steps (`INVESTIGATE`, `PLAN`, `WRITE_TESTS`, `EXECUTE`, `VERIFY`, `FINALIZE`).
-   **WorkerManager & Specialists**: A provider-agnostic layer that coordinates LLM calls (via Ollama, OpenAI, or Anthropic) and executes "specialist" roles (Researcher, Foreman, Judge).
-   **LedgerStorageEngine**: A file-based persistence layer that manages projects, tasks, settings, chat history, and the knowledge base with strict concurrency locking.
-   **LocalEventBus**: Facilitates decoupled communication across the system for logging, real-time streaming (SSE), and evaluation monitoring.

---

## 🚀 Key Features

### 1. 💬 Interactive Conversational Experience
Ralph provides a true back-and-forth chat experience for both specific tasks and broader project architecture.
-   **Memory Injection**: Automatically injects the last 10 turns of conversation into the LLM's context.
-   **FSM Firewall**: Strictly ignores messages with the `CHAT` intent to ensure discussions don't accidentally trigger state transitions or code modifications.
-   **SSE Streaming**: Real-time response streaming in the terminal for a more "alive" feel.

### 2. 📚 Knowledge Database (KD)
Ralph manages a local, machine-optimized knowledge base (`knowledge.json`) to store runbooks, architectural patterns, and policies.
-   **Semantic Tooling**: Ralph can autonomously search the KB during investigation and update it upon successful task completion.
-   **Self-Learning**: If a task requires multiple retries, Ralph is instructed to document the solution as a "Runbook" entry to prevent future failures.

### 3. 🧹 Janitor/Reviewer Daemon
Ralph shifts from reactive to proactive via the Janitor service.
-   **Idle Loop**: When no tasks are enqueued for a configurable period (default: 1 hour), Ralph enters "Proactive Mode."
-   **Audit Pipelines**:
    -   **Dependency Audit**: Scans `package.json` for vulnerabilities and outdated packages.
    -   **Code Smell Review**: Audits recent Git commits for missing types, debugging remnants, or refactoring needs.
-   **Autonomous Handoff**: Janitor findings are automatically converted into standard FSM tasks for verification and PR creation.

### 4. 🧪 Optional TDD Pipeline
For complex logic changes or bug fixes, Ralph can engage a strict Test-Driven Development flow.
-   **Reproduction First**: Ralph must write a failing test that reproduces the bug before he is allowed to touch any implementation code.
-   **Verify Fail**: The system validates the test failure in a Docker sandbox. Only after a "Successful Failure" does he proceed to the `EXECUTE` phase.

### 5. 📉 Asynchronous Evaluation Framework
A built-in CI/CD pipeline for the AI itself.
-   **Eval Scenarios**: Pre-configured test cases (e.g., `tdd-auth-bypass`) that challenge Ralph's reasoning and execution.
-   **LLM-as-a-Judge**: A specialist "Judge" model automatically grades the final output on quality, correctness, and adherence to TDD principles.
-   **Sandbox Isolation**: All evaluations run in ephemeral workspaces with flagged project records to prevent main-branch pollution.

---

## 💻 CLI Usage

Ralph's terminal interface supports standard commands and interactive modes.

### Task Management
-   `ralph solve "Fix the JWT bug" --tdd`: Start a solving task with TDD enabled.
-   `ralph list`: View the current task backlog.
-   `ralph logs <taskId>`: Stream the "thought process" and tool output for a task.

### Interactive Chat
-   `ralph chat:start <taskId>`: Drop into a real-time REPL for a specific task.
-   `ralph chat:project <projectId>`: Discuss project architecture and logic.

### Knowledge Base
-   `ralph kb:search "quota limits"`: Search the KB.
-   `ralph kb:read <entryId>`: Read a specific knowledge entry.
-   `ralph kb:request <projectId> "How does the bus work?"`: Ask Ralph to research and document a concept.

### Evaluation & System
-   `ralph eval:run <scenarioId>`: Trigger an AI performance test.
-   `ralph eval:status <evalId>`: View the scorecard and judge's feedback.
-   `ralph janitor:run`: Manually trigger a proactive audit.
-   `ralph config`: View or update system settings (e.g., active model, janitor interval).

---

## 🛠 Technical Stack

-   **Runtime**: Node.js (ESM)
-   **Language**: TypeScript
-   **LLM Engine**: Ollama (Native Tool Calling), OpenAI, Anthropic
-   **Isolation**: Docker (via Dockerode) for CI/CD and verification.
-   **API**: Express with Server-Sent Events (SSE).
-   **Styling**: Chalk for a rich terminal experience.

---

## ⚙️ Configuration

Ralph uses a `.env` file for core connectivity and `ledger.json` for runtime settings.

```env
PORT=3000
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:4b-instruct
ACTIVE_LLM_PROVIDER=ollama-local
JANITOR_ENABLED=true
TDD_MODE_ENABLED=false
```

---

*Created by FLYBYME. Ralph is designed for engineers who want a proactive partner in the codebase.*
