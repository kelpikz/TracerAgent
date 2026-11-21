import { execFile } from 'node:child_process';

export function stopCommand(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true },
      error => { if (error) child.kill('SIGKILL'); });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill('SIGKILL');
    }
  }
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}
