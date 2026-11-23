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

/** Kills a process and every process under it. Resolves when the kill command ends. */
export async function killTree(pid) {
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill.exe', ['/pid', String(pid), '/t', '/f'],
      { windowsHide: true }, () => resolve()));
    return;
  }
  // Agent commands run in their own process groups, so find the children first.
  const stdout = await new Promise(resolve => execFile('ps', ['-A', '-o', 'pid=,ppid='],
    (error, output) => resolve(error ? '' : output)));
  const children = new Map();
  for (const line of stdout.trim().split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const tree = [pid];
  for (let i = 0; i < tree.length; i++) tree.push(...(children.get(tree[i]) ?? []));
  for (const target of tree.flatMap(id => [-id, id])) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // The process or group is already gone.
    }
  }
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
