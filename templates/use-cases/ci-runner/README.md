# CI Runner Template

H1 listens for GitHub webhooks and monitors repository activity. H2 wakes on-demand to run builds, tests, and deployments.

## Use Case

You have personal projects or a small team that needs CI/CD, but GitHub Actions costs are adding up ($0.008/minute for private repos). You have a powerful development machine that sits idle most of the day.

**Solution:** H1 runs a lightweight webhook server 24/7 on a cheap VM. When code is pushed, H1 wakes H2 to run the full build/test suite, then H2 goes back to sleep.

## Cost Savings Example

**Before (GitHub Actions):**
- 1000 min/month build time
- $8/month for private repos
- Limited to GitHub-hosted runners

**After (H1 + H2):**
- H1: $5/month (tiny webhook server)
- H2: $0/month (your existing hardware)
- Full control over build environment

**Savings:** $3/month + unlimited build minutes

## Setup

### 1. Hardware Requirements

**H1 (webhook listener):**
- Minimal VM (512MB RAM is enough)
- Public IP or ngrok tunnel

**H2 (build runner):**
- Depends on your stack (16GB+ RAM recommended)
- SSD for fast builds
- GPU optional (for ML model training in CI)

### 2. Install GitHub Webhook Server on H1

```bash
npm install -g webhook
# Or use this simple Express server (see example below)
```

### 3. Configure GitHub Webhook

In your repo settings:
- Webhook URL: `http://your-h1-ip:3000/webhook`
- Content type: `application/json`
- Events: Push, Pull Request
- Secret: Generate a random token

### 4. Initialize Template

```bash
cd ~/.openclaw
cofounder templates init ci-runner
```

## Example Code

### H1: Webhook Server

```typescript
// webhook-server.ts on H1
import express from 'express';
import crypto from 'node:crypto';
import { sendTask } from '@cofounder/sdk';

const app = express();
app.use(express.json());

const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// Verify GitHub webhook signature
function verifySignature(req: express.Request): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) return false;

  const hash = crypto
    .createHmac('sha256', GITHUB_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return signature === `sha256=${hash}`;
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.headers['x-github-event'];
  const { repository, ref, head_commit } = req.body;

  // Only build on push to main/master
  if (event === 'push' && (ref === 'refs/heads/main' || ref === 'refs/heads/master')) {
    console.log(`Push detected: ${repository.full_name} @ ${head_commit.id.slice(0, 7)}`);

    // Wake H2 and run build
    await sendTask({
      to: 'H2',
      objective: `Build and test ${repository.name}`,
      payload: {
        repo: repository.clone_url,
        commit: head_commit.id,
        branch: ref.replace('refs/heads/', ''),
        author: head_commit.author.name,
      },
      wake_required: true,
      shutdown_after: true,
    });

    res.status(200).send('Build queued');
  } else {
    res.status(200).send('Ignored');
  }
});

app.listen(3000, () => {
  console.log('Webhook server listening on :3000');
});
```

### H2: Build Runner

```typescript
// build-runner.ts on H2
import { onTask } from '@cofounder/sdk';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);

const WORKSPACE = '/tmp/ci-builds';

onTask(async (task) => {
  const { repo, commit, branch, author } = task.payload;
  const buildDir = path.join(WORKSPACE, `build-${Date.now()}`);

  try {
    // Clone repo
    console.log(`Cloning ${repo}...`);
    await execAsync(`git clone ${repo} ${buildDir}`);
    await execAsync(`git checkout ${commit}`, { cwd: buildDir });

    // Install dependencies
    console.log('Installing dependencies...');
    const hasPackageJson = await fs.access(path.join(buildDir, 'package.json')).then(() => true).catch(() => false);

    if (hasPackageJson) {
      await execAsync('npm ci', { cwd: buildDir });
    }

    // Run tests
    console.log('Running tests...');
    const { stdout: testOutput, stderr: testErrors } = await execAsync('npm test', { cwd: buildDir });

    // Run build
    console.log('Running build...');
    await execAsync('npm run build', { cwd: buildDir });

    // Cleanup
    await fs.rm(buildDir, { recursive: true, force: true });

    return {
      output: `✅ Build successful for ${commit.slice(0, 7)} by ${author}\n\n${testOutput}`,
      metadata: {
        commit,
        branch,
        tests_passed: true,
        build_time_ms: Date.now() - task.started_at,
      },
    };

  } catch (error) {
    // Cleanup on failure
    await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {});

    return {
      output: `❌ Build failed for ${commit.slice(0, 7)}\n\n${error.message}`,
      metadata: {
        commit,
        branch,
        tests_passed: false,
        error: error.message,
      },
    };
  }
});
```

## Advanced: Notify on Failure

Send Slack/Discord notification when builds fail:

```typescript
// On H2, after build completes
if (!result.metadata.tests_passed) {
  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🚨 Build failed: ${repo} @ ${commit.slice(0, 7)}`,
      attachments: [{
        color: 'danger',
        text: result.output,
      }],
    }),
  });
}
```

## Advanced: Matrix Builds

Test multiple Node versions in one wake cycle:

```typescript
// On H2
const nodeVersions = ['18', '20', '22'];
const results = [];

for (const version of nodeVersions) {
  const { stdout, stderr } = await execAsync(
    `docker run --rm -v ${buildDir}:/app -w /app node:${version} npm test`
  );
  results.push({ version, passed: stderr.length === 0 });
}

return {
  output: results.map(r => `Node ${r.version}: ${r.passed ? '✅' : '❌'}`).join('\n'),
};
```

## Production Tips

1. **Docker builds:** Use Docker for consistent build environments across machines.

2. **Caching:** Keep `node_modules` cached between builds on H2 (speeds up `npm ci`).

3. **Parallel builds:** If you have multiple PRs, queue them and process in parallel (if H2 has enough resources).

4. **Deploy on success:** Auto-deploy to staging/production after successful builds.

5. **Branch protection:** Set GitHub branch protection to require CI checks before merging.

## Monitoring

Track with `cofounder web`:
- **Build success rate:** % of builds passing
- **Average build time:** Optimize slow tests
- **H2 wake frequency:** How often builds trigger

## Troubleshooting

**Webhook not triggering:**
- Check firewall allows inbound on port 3000
- Verify webhook URL in GitHub settings
- Check webhook delivery logs in GitHub

**Builds timing out:**
- Increase task timeout in Cofounder config
- Optimize test suite (run unit tests only, not integration)
- Use `npm ci --prefer-offline` for faster installs

**Out of disk space:**
- Cleanup old build directories: `rm -rf /tmp/ci-builds/*`
- Use Docker with volume cleanup
- Add automated cleanup cron job

## Next Steps

- Add deployment step (deploy to Vercel/Netlify after successful build)
- Integrate with GitHub Checks API (show build status in PR)
- Add test coverage reporting (send to Codecov)
- Support multiple repositories (multi-tenant CI server)