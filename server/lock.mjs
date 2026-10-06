import {
  openSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

// Acquire before opening SQLite: a second process must never run recovery over
// an in-flight request owned by the first process.
export function acquireLock(dbPath) {
  const path = `${dbPath}.lock`;
  const owner = { pid: process.pid, token: randomUUID() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(owner));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(readFileSync(path, "utf8")).token === owner.token)
            unlinkSync(path);
        } catch {}
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try {
        previous = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        throw new Error("数据库锁无法确认，请检查是否已有服务运行");
      }
      if (!Number.isInteger(previous.pid) || previous.pid < 1)
        throw new Error("数据库锁无效，请人工检查运行实例");
      try {
        process.kill(previous.pid, 0);
        throw new Error("已有服务运行，不能同时打开数据库");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      // Recheck the token to avoid removing a newly replaced owner's lock.
      if (JSON.parse(readFileSync(path, "utf8")).token === previous.token)
        unlinkSync(path);
    }
  }
  throw new Error("无法获得数据库运行锁");
}
