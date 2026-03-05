---
title: Code Review
description: Analyze code for bugs, security issues, and improvements
triggers: review, code review, analyze code, check code
enabled: true
---

When asked to review code, follow this structured approach:

1. **Security scan** — Look for hardcoded secrets, SQL injection, XSS, path traversal, and insecure defaults.
2. **Bug detection** — Check for null/undefined errors, off-by-one errors, race conditions, and unhandled edge cases.
3. **Performance** — Identify N+1 queries, unnecessary re-renders, memory leaks, and blocking operations.
4. **Best practices** — Check naming conventions, error handling, type safety, and code organization.
5. **Suggestions** — Provide specific, actionable improvements with code examples.

Format your review as:
- 🔴 **Critical** — Must fix (security, data loss)
- 🟡 **Warning** — Should fix (bugs, performance)
- 🟢 **Suggestion** — Nice to have (style, readability)
