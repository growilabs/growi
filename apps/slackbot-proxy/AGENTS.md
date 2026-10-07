# GROWI Slackbot Proxy (apps/slackbot-proxy)

A proxy service that enables Slack integration for GROWI instances, handling OAuth flows, event subscriptions, and message relay between Slack and GROWI.

## Technology Stack

| Component | Technology |
|-----------|------------|
| **Framework** | Ts.ED 6.x (Express-based TypeScript framework) |
| **Database** | MySQL with TypeORM 0.2.x |
| **Slack SDK** | @slack/oauth, @slack/web-api |
| **Views** | EJS templates |
| **Health Checks** | @godaddy/terminus |

## Quick Reference

### Essential Commands

```bash
# Development
pnpm run dev                        # Start dev server with nodemon

# Quality Checks
pnpm run lint:typecheck             # TypeScript type check
pnpm run lint:biome                 # Biome linter
pnpm run lint                       # Run all linters

# Build & Production
pnpm run build                      # Build for production
pnpm run start:prod                 # Start production server
```

### Directory Structure

```
src/
├── index.ts                  # Application entry point
├── Server.ts                 # Ts.ED server configuration
├── entities/                 # TypeORM entities
│   ├── installation.ts       # Slack app installation data
│   ├── relation.ts           # GROWI-Slack relation mapping
│   ├── order.ts              # Command order tracking
│   └── system-information.ts # System metadata
├── repositories/             # TypeORM repositories
├── controllers/              # Ts.ED controllers
│   ├── slack.ts              # Slack event handlers
│   ├── growi-to-slack.ts     # GROWI → Slack message relay
│   ├── top.ts                # Landing page
│   ├── term.ts               # Terms of service
│   └── privacy.ts            # Privacy policy
├── services/                 # Business logic
│   ├── InstallerService.ts   # Slack app installation
│   ├── RegisterService.ts    # GROWI registration
│   ├── RelationsService.ts   # GROWI-Slack relations
│   └── growi-uri-injector/   # URI injection for Slack messages
├── middlewares/              # Express middlewares
│   ├── slack-to-growi/       # Slack → GROWI direction
│   └── growi-to-slack/       # GROWI → Slack direction
├── interfaces/               # TypeScript interfaces
├── filters/                  # Error filters
├── config/                   # Configuration files
│   ├── logger/               # Logging configuration
│   └── swagger/              # Swagger configuration
└── views/                    # EJS templates
```

## Architecture

### Message Flow

```
┌─────────┐     ┌────────────────┐     ┌───────┐
│  Slack  │ ←→  │ Slackbot Proxy │ ←→  │ GROWI │
└─────────┘     └────────────────┘     └───────┘
```

1. **Slack → GROWI**: Slack events/commands are received, validated, and forwarded to registered GROWI instances
2. **GROWI → Slack**: GROWI sends notifications/responses through the proxy to Slack

### Key Entities

| Entity | Description |
|--------|-------------|
| `Installation` | Slack app installation data (tokens, team info) |
| `Relation` | Maps GROWI instances to Slack workspaces |
| `Order` | Tracks command execution order |
| `SystemInformation` | System metadata |

## Development Guidelines

### 1. Ts.ED Controller Pattern

```typescript
import { Controller, Post, Req, Res } from '@tsed/common';
import { SlackEventMiddleware } from '../middlewares/slack-to-growi/authorizer';

@Controller('/slack')
export class SlackController {
  @Post('/events')
  @UseBefore(SlackEventMiddleware)
  async handleEvent(@Req() req: Request, @Res() res: Response) {
    // Handle Slack event
  }
}
```

### 2. TypeORM Entity Pattern

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Installation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  teamId: string;

  @Column()
  botToken: string;
}
```

### 3. Middleware Pattern (Bidirectional)

Middlewares are organized by direction:

- `middlewares/slack-to-growi/` - Process incoming Slack events
- `middlewares/growi-to-slack/` - Process outgoing messages to Slack

```typescript
// middlewares/slack-to-growi/authorizer.ts
import { Middleware, Req, Next } from '@tsed/common';

@Middleware()
export class AuthorizerMiddleware {
  use(@Req() req: Request, @Next() next: () => void) {
    // Validate Slack signature
    next();
  }
}
```

## API Endpoints

### Slack Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/slack/events` | Slack event subscription endpoint |
| POST | `/slack/interactions` | Slack interactive components |
| GET | `/slack/oauth/callback` | OAuth callback |

### GROWI Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/g2s/*` | GROWI to Slack relay |

### Web Pages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Landing page |
| GET | `/term` | Terms of service |
| GET | `/privacy` | Privacy policy |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port |
| `DATABASE_URL` | MySQL connection string |
| `SLACK_CLIENT_ID` | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Slack app client secret |
| `SLACK_SIGNING_SECRET` | Slack signing secret |

## Database Configuration

TypeORM is configured with MySQL. Entity synchronization should be disabled in production.

```typescript
// In Server.ts
@Configuration({
  typeorm: {
    connections: {
      default: {
        type: 'mysql',
        url: process.env.DATABASE_URL,
        entities: [Installation, Relation, Order, SystemInformation],
        synchronize: process.env.NODE_ENV !== 'production',
      },
    },
  },
})
```

## Before Committing

```bash
pnpm run lint:typecheck   # Type check
pnpm run lint:biome       # Lint
pnpm run build            # Verify build
```

## Integration with GROWI

GROWI instances register with the proxy using the `@growi/slack` package:

```typescript
// In apps/app
import { SlackIntegration } from '@growi/slack';

const slack = new SlackIntegration({
  proxyUrl: 'https://slackbot-proxy.example.com',
});
```

---

This service is deployed separately and requires its own MySQL database. It acts as a central hub for multiple GROWI instances to communicate with Slack.
