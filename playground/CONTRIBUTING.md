# Contributing Guidelines

Thank you for your interest in contributing! To ensure a smooth collaboration, please follow these guidelines.

## 1. Issue Reporting Process
Before opening a new issue, please search the existing ones to avoid duplicates. When reporting a bug or requesting a feature:
- Use a clear and descriptive title.
- Provide a detailed description of the issue or enhancement.
- For bugs, include steps to reproduce, expected behavior, and actual results.
- Mention your environment (OS, versions, etc.) if relevant.

## 2. How to Submit a Pull Request
We follow a standard fork-and-pull model:
1. **Fork** the repository and create your branch from `main`.
2. **Setup** the environment locally. You can use the provided `Dockerfile`:
   ```bash
   docker build -t playground .
   docker run playground
   ```
3. **Commit** your changes with clear, descriptive messages.
4. **Push** to your fork and submit a Pull Request (PR) to the original repository.
5. **Link** any related issues in your PR description.

## 3. Code Style and Formatting
To maintain a clean and consistent codebase:
- **Simplicity:** Write clear, concise, and self-documenting code.
- **Consistency:** Follow existing naming conventions and architectural patterns.
- **Documentation:** Add comments for complex logic and update `README.md` if necessary.
- **Formatting:** Ensure your code is well-formatted and free of unnecessary white space.

## 4. Code Review Expectations
All contributions undergo review to ensure quality and consistency:
- **Be Open:** Expect constructive feedback from maintainers.
- **Responsiveness:** Address requested changes or questions promptly.
- **Respect:** Maintain a professional and respectful tone in all communications.

Once approved and all checks pass, your PR will be merged. Happy coding!
