const express = require('express');
const path = require('path');
const { execFile, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LAUNCH_AGENT_LABEL = 'com.wapi101.app';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: REPO_ROOT, timeout: 30_000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

module.exports = function adminRoutes(_db) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.advisor?._viaMachineToken) {
      return res.status(403).json({ error: 'Los tokens de máquina no pueden ejecutar deploys' });
    }
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    next();
  });

  router.get('/version', async (_req, res) => {
    const head = await run('git', ['rev-parse', '--short', 'HEAD']);
    const subj = await run('git', ['log', '-1', '--pretty=%s']);
    const date = await run('git', ['log', '-1', '--pretty=%cI']);
    res.json({
      commit: head.stdout.trim(),
      subject: subj.stdout.trim(),
      date: date.stdout.trim(),
    });
  });

  router.post('/deploy', async (_req, res) => {
    const before = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const fetchR = await run('git', ['fetch', '--prune', 'origin']);
    if (!fetchR.ok) {
      return res.status(500).json({ error: 'git fetch falló', detail: fetchR.stderr.slice(0, 500) });
    }
    const pull = await run('git', ['pull', '--ff-only']);
    if (!pull.ok) {
      return res.status(500).json({ error: 'git pull falló', detail: (pull.stderr || pull.stdout).slice(0, 500) });
    }
    const after = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const subjR = await run('git', ['log', '-1', '--pretty=%s']);
    const noChanges = before === after;

    res.json({
      ok: true,
      noChanges,
      before: before.slice(0, 7),
      after: after.slice(0, 7),
      subject: subjR.stdout.trim(),
      log: pull.stdout.slice(0, 1000),
      restartScheduled: !noChanges,
    });

    if (noChanges) return;

    setTimeout(() => {
      try {
        const uid = process.getuid ? process.getuid() : 501;
        const child = spawn('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } catch (e) {
        console.error('[admin/deploy] restart failed:', e);
      }
    }, 500);
  });

  return router;
};
