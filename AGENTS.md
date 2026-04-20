# AGENTS.md

## Overview

This document provides guidance for automated coding agents working within this repository. It outlines agent responsibilities, operational guidelines, and references to APIs and tools to help agents function effectively.

## Agent Roles & Responsibilities

List each agent and assign its specific roles and responsibilities below. (You will be prompted to specify which agent(s) should work on which role(s).)

| Agent Name    | Role(s) / Responsibilities                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| any GPT       | Documentation, Run tests                                                                                                |
| Claude Sonnet | Code generation, Write and update tests, Dependency management, Linting and formatting, Error handling, API integration |
| Claude Opus   | Refactoring                                                                                                             |

## Repository Structure

- **packages/model-viewer**: Main application code. All application logic, features, and core functionality should be placed and edited here.
- **packages/modelviewer.dev**: Documentation and example site. All documentation, guides, and example-related changes should be limited to this directory.

Agents must limit all code edits to:

- Application: packages/model-viewer
- Documentation: packages/modelviewer.dev

## Usage Guidelines

- Always start with `nvm use` to ensure the correct Node.js version is active.
- During development, the build command is `npm run build:dev` inside `packages/model-viewer`.
- For final test and production builds, use `npm run build` inside `packages/model-viewer`.
- Agents should operate within the boundaries of the repository’s coding standards and best practices.
- All file edits must be atomic and well-documented.
- Commit messages should be clear and descriptive.
- Handle errors gracefully and report issues when encountered.
- Collaborate with other agents and respect file ownership where applicable.

## Documentation Guidelines

To write or update documentation:

- API documentation is maintained in `packages/modelviewer.dev/data/docs.json`. Add or update entries here for each feature, including clear descriptions, default values, and links to relevant examples. The feature or mixin name in the documentation must match the source file or module name (e.g., `ld_camera.ts` should be documented under "LD Camera").
- Example metadata is managed in `packages/modelviewer.dev/data/examples.json`. Add or update entries here to register new examples or categories.
- Example pages are implemented as HTML files in `packages/modelviewer.dev/examples/`. Create or update these files to provide runnable demonstrations.
- Whenever an example is added or reordered in `packages/modelviewer.dev/examples/`, update `packages/modelviewer.dev/data/examples.json` in the same change.
- Each major feature documented in `docs.json` should have at least one corresponding example page listed in `examples.json` and implemented in the examples directory.
- In `docs.json`, link to the most relevant example pages for each feature, but you do not need a separate example for every method or property.
- Keep cross-references between documentation and examples up to date and consistent.

## API References

Agents may use the following APIs, libraries, or tools to perform their tasks:

- [Node.js](https://nodejs.org/) – JavaScript runtime environment
- [Three.js](https://threejs.org/) – 3D library used in this project
- [@yomotsu/camera-controls](https://yomotsu.github.io/camera-controls/) – Advanced camera controls
- [@fennec-hub/three-viewport-gizmo](https://fennec-hub.github.io/three-viewport-gizmo/) – Customizable standalone interactive three.js view helper controls
- [Rollup](https://rollupjs.org/) – Module bundler
- [Tailwind CSS](https://tailwindcss.com/) – Utility-first CSS framework
- [Web Test Runner](https://modern-web.dev/docs/test-runner/overview/) – Testing framework
- [TypeScript](https://www.typescriptlang.org/) – Typed JavaScript

Add more references as needed for new tools or APIs.

## Best Practices

- Follow the repository’s code style and formatting rules.
- Write modular, maintainable, and well-documented code.
- Enforce DRY (Don't Repeat Yourself) principles.
- Only function and class blocks need to be documented; do not document individual lines within functions.
- Review changes before committing.
- Communicate and coordinate with other agents to avoid conflicts.
- Keep this document updated as agent roles or APIs evolve.
