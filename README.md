# Ralph: The Autonomous AI Programming Agent

Ralph is a proactive, state-driven AI automation agent designed to act as a co-maintainer for your codebases. Unlike standard chat assistants, Ralph operates via a Finite State Machine (FSM), possesses persistent memory, and can autonomously find and fix issues while you sleep.

---

## 🏗 High-Level Architecture

Ralph is built on a modular, event-driven architecture that separates high-level orchestration from low-level execution.

### **1. Orchestration Layer**
-   **DaemonOrchestrator**: The heartbeat of the system. It runs an infinite loop (default 1s tick) that monitors the `TaskQueue`. If the queue is empty, it tracks idle time to trigger the **Janitor Service**. It also manages the **Zombie Recovery Routine** to resume tasks interrupted by system crashes.
-   **Finite State Machine (FSM)**: Every task follows a strict lifecycle. Each state has a dedicated `StepHandler` that validates the task's context before execution. Transitions are deterministic but can be overridden by specialists or manual human intervention.

### **2. Intelligence Layer**
-   **WorkerManager**: The central coordinator for LLM interactions. It implements a **ReAct loop** (Reasoning + Action), allowing specialists to call tools, observe results, and iterate until an objective is met.
-   **Specialists**: Modular roles injected with specific system prompts:
    -   **Researcher**: Dispatched during `INVESTIGATE` to map dependencies and root causes.
    -   **Foreman**: Dispatched during `EXECUTE` to coordinate multiple sub-agents for complex refactors.
    -   **Judge**: Dispatched during `EVALUATION` to grade performance based on a multi-point rubric.
-   **PromptBuilder**: Dynamically assembles context (files, chat history, FSM state) into optimized LLM instructions.

### **3. Infrastructure & Data**
-   **LedgerStorageEngine**: A file-based "Source of Truth."
    -   `ledger.json`: Global registry of projects, tasks summaries, and settings.
    -   `/tasks/{id}.json`: Deep persistent memory for each task, including the full `StateContext` and message thread.
    -   `knowledge.json`: The autonomous Knowledge Database.
-   **LocalEventBus**: A decoupled pub/sub system. Every state transition, tool call, and specialist log is broadcasted as a structured event, powering the real-time SSE stream and the Evaluation Manager.

---

## 🚀 Key Features: Deep Dive

### **💬 Interactive Conversational Experience**
Ralph isn't just a command-line tool; he's a pair programmer.
-   **Memory Injection**: When you enter `chat:start`, Ralph retrieves the last 10 messages from the task thread. These are mapped to `user` and `assistant` roles, providing context-aware continuity.
-   **FSM Firewall**: The `ContextAnalyzer` intercepts every human message. If a message is tagged with the `CHAT` intent, the FSM is forbidden from transitioning to an actionable state (like `EXECUTE`), ensuring your "What if?" questions remain safe discussions.

### **📚 Knowledge Database (KD)**
Ralph builds his own documentation.
-   **Publishing**: Upon completing a complex task (especially those requiring retries), Ralph is instructed to call the `publishKnowledge` tool. This saves a structured JSON entry with categories (e.g., `Runbook`) and tags.
-   **Autonomous Retrieval**: During the `INVESTIGATE` phase, Ralph semantically searches the KD. If he finds a relevant Runbook from a previous failure, he avoids the same mistakes, effectively "learning" over time.

### **🧹 Janitor/Reviewer Daemon**
The Janitor service turns idle CPU time into project maintenance.
-   **Trigger**: If the `consecutiveIdleTicks` exceeds the threshold (e.g., 1 hour), the Janitor wakes up.
-   **Dependency Pipeline**: Scans for `package.json`, runs a simulated `npm audit`, and if gaps are found, enqueues an `AuditAction` task.
-   **Code Smell Pipeline**: Uses the `GitRunner` to find recent changes and dispatches a specialist to review them for technical debt or security flaws.

### **🧪 Optional TDD Pipeline**
Engage "Hard Mode" for bug fixes using the `--tdd` flag.
1.  **WRITE_TESTS**: Ralph is restricted to test files. He must write a test that fails due to the reported bug.
2.  **VERIFY_FAIL**: The system runs the test suite via Docker. If the test *passes*, the FSM loops back—Ralph must prove the bug exists before he can fix it.
3.  **EXECUTE**: Only once a failing test is confirmed does Ralph receive permission to modify the source code.

### **📉 Asynchronous Evaluation Framework**
A dedicated CI/CD suite for AI performance.
-   **Sandbox Generation**: When an eval starts, the system creates a `/tmp/ralph-evals/` workspace and copies the target template codebase.
-   **Event-Driven Grading**: The `EvalManager` tracks the task's FSM path. Once finished, it triggers a final Docker verification and dispatches an independent LLM "Judge" to generate a scorecard (Pass/Fail, Code Quality, TDD Adherence).

---

## 💻 CLI Command Reference

| Command | Description | Example |
| :--- | :--- | :--- |
| `solve` | Create a new solving task | `ralph solve "Refactor auth" --tdd` |
| `chat:start` | Start task-level REPL | `ralph chat:start <taskId>` |
| `chat:project` | Discuss project architecture | `ralph chat:project <projectId>` |
| `kb:search` | Search knowledge base | `ralph kb:search "middleware"` |
| `kb:request` | Ask Ralph to document a concept | `ralph kb:request p1 "How is logging handled?"` |
| `eval:run` | Run an evaluation scenario | `ralph eval:run tdd-auth-bypass` |
| `janitor:run` | Manual maintenance audit | `ralph janitor:run` |
| `stream` | Real-time global event monitor | `ralph stream --backlog` |
| `config` | View/Edit settings | `ralph config model gpt-4o` |

---

## 🛠 Technical Stack

-   **LLM Provider**: Ollama (Native Tool Calling), OpenAI, Anthropic.
-   **Containerization**: Docker (via Dockerode) for isolated CI/CD.
-   **Server**: Express.js with SSE for event streaming.
-   **Terminal**: Commander.js + Chalk for a rich interactive CLI.
-   **Safety**: Strict file-locking (`withLock`) to prevent ledger corruption.

---

## ⚙️ Setup & Development

### **1. Prerequisites**
-   Node.js v20+
-   Ollama (running locally)
-   Docker (for `VERIFY` and `EVAL` phases)

### **2. Installation**
```bash
git clone https://github.com/FLYBYME/ralph.git
cd ralph
npm install
cp .env.example .env
```

### **3. Start the Daemon**
```bash
# Terminal 1: Start the API & Orchestrator
npm run dev

# Terminal 2: Interact via CLI
ralph help
```

---

*Created by FLYBYME. Ralph is designed for engineers who want a proactive partner in the codebase.*
