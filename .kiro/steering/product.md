# Product Overview

GROWI is a team collaboration wiki platform using Markdown, designed to help teams document, share, and organize knowledge effectively.

## Core Capabilities

1. **Hierarchical Wiki Pages**: Tree-structured page organization with path-based navigation (`/path/to/page`)
2. **Markdown-First Editing**: Rich Markdown support with extensions (drawio, lsx, math) and Yjs-based real-time collaborative editing
3. **AI-Assisted Editing**: OpenAI/Azure OpenAI integration for editor assistance, page path suggestion, and customizable AI assistants with knowledge bases (vector stores)
4. **Authentication Integrations**: Multiple auth methods (LDAP, SAML, OAuth, Passkey) for enterprise environments
5. **Plugin System**: Extensible architecture via `@growi/pluginkit` for custom remark plugins and functionality
6. **Audit & Compliance**: Activity logging, audit log search (Elasticsearch-backed), and bulk export for compliance needs
7. **Multi-Service Architecture**: Modular services (PDF export, Slack integration) deployed independently
8. **Observability**: OpenTelemetry integration for monitoring and tracing

## Target Use Cases

- **Team Documentation**: Technical documentation, meeting notes, project wikis
- **Knowledge Management**: Searchable, organized information repository
- **Enterprise Deployment**: Self-hosted wiki with SSO/LDAP integration
- **Developer Teams**: Markdown-native, Git-friendly documentation workflow

## Value Proposition

- **Open Source**: MIT licensed, self-hostable, community-driven
- **Markdown Native**: First-class Markdown support with powerful extensions
- **Hierarchical Organization**: Intuitive path-based page structure (unlike flat wikis)
- **Enterprise Ready**: Authentication integrations, access control, scalability
- **Extensible**: Plugin system for customization without forking

## Deployment Models

- **Self-Hosted**: Docker, Kubernetes, or bare metal deployment
- **Microservices**: Optional services (pdf-converter, slackbot-proxy) for enhanced functionality

---
_Updated: 2026-04-16. Added AI assistant, audit/compliance, and observability capabilities._
_Focus on patterns and purpose, not exhaustive feature lists_
