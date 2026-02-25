# GROWI PDF Converter (apps/pdf-converter)

A microservice for converting GROWI pages to PDF format using Puppeteer.

## Technology Stack

| Component | Technology |
|-----------|------------|
| **Framework** | Ts.ED 8.x (Express-based TypeScript framework) |
| **PDF Generation** | Puppeteer ^23.1.1 with puppeteer-cluster |
| **API Documentation** | Swagger via @tsed/swagger |
| **Health Checks** | @godaddy/terminus |

## Quick Reference

### Essential Commands

```bash
# Development
pnpm run dev:pdf-converter          # Start dev server with nodemon

# Quality Checks
pnpm run lint:typecheck             # TypeScript type check
pnpm run lint:biome                 # Biome linter
pnpm run test                       # Run tests

# Build & Production
pnpm run build                      # Build for production
pnpm run start:prod                 # Start production server
```

### Directory Structure

```
src/
├── index.ts              # Application entry point
├── server.ts             # Ts.ED server configuration
├── controllers/
│   ├── index.ts          # Controller exports
│   ├── pdf.ts            # PDF conversion endpoint
│   ├── pdf.spec.ts       # Controller tests
│   └── terminus.ts       # Health check endpoint
├── service/
│   └── pdf-convert.ts    # Puppeteer PDF conversion logic
└── bin/
    └── index.ts          # CLI commands (swagger generation)
```

## Development Guidelines

### 1. Ts.ED Controller Pattern

Controllers use Ts.ED decorators:

```typescript
import { Controller, Get, Post } from '@tsed/common';
import { Returns } from '@tsed/schema';

@Controller('/pdf')
export class PdfController {
  @Post('/')
  @Returns(200, Buffer)
  async convert(@BodyParams() body: ConvertRequest): Promise<Buffer> {
    return this.pdfService.convert(body.html);
  }
}
```

### 2. Puppeteer Service

The PDF conversion service uses puppeteer-cluster for parallel processing:

```typescript
// service/pdf-convert.ts
import { Cluster } from 'puppeteer-cluster';

export class PdfConvertService {
  private cluster: Cluster;

  async convert(html: string): Promise<Buffer> {
    return this.cluster.execute(html, async ({ page, data }) => {
      await page.setContent(data);
      return page.pdf({ format: 'A4' });
    });
  }
}
```

### 3. Health Checks

Use @godaddy/terminus for Kubernetes-compatible health endpoints:

- `/health/liveness` - Is the service alive?
- `/health/readiness` - Is the service ready to accept requests?

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/pdf` | Convert HTML to PDF |
| GET | `/health/liveness` | Liveness probe |
| GET | `/health/readiness` | Readiness probe |

### Generate Swagger Spec

```bash
pnpm run gen:swagger-spec
```

Outputs to `specs/` directory.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `SKIP_PUPPETEER_INIT` | Skip Puppeteer initialization (for tests) | false |

## Testing

Tests use Vitest with supertest for HTTP assertions:

```typescript
import { describe, it, expect } from 'vitest';
import supertest from 'supertest';

describe('PdfController', () => {
  it('should convert HTML to PDF', async () => {
    const response = await supertest(app)
      .post('/pdf')
      .send({ html: '<h1>Hello</h1>' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
  });
});
```

## Integration with GROWI

The main GROWI app (`apps/app`) uses `@growi/pdf-converter-client` package to communicate with this service:

```typescript
// In apps/app
import { PdfConverterClient } from '@growi/pdf-converter-client';

const client = new PdfConverterClient('http://pdf-converter:3001');
const pdfBuffer = await client.convert(pageHtml);
```

## Before Committing

```bash
pnpm run lint:typecheck   # Type check
pnpm run lint:biome       # Lint
pnpm run test             # Run tests
pnpm run build            # Verify build
```

---

This service is deployed separately from the main GROWI application and communicates via HTTP.
