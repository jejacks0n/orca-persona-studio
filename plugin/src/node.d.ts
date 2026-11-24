// The plugin has no @types/node; these declare the few Node built-ins the worker and tests use.
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8' | 'base64'): string
  export function mkdirSync(path: string, options: { recursive: true }): unknown
  export function mkdtempSync(prefix: string): string
  export function writeFileSync(path: string, data: string): void
  export function copyFileSync(src: string, dest: string): void
  export function cpSync(src: string, dest: string, options: { recursive: true }): void
  export function rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void
  export function openSync(path: string, flags: 'r' | 'a'): number
  export function fstatSync(fd: number): { size: number; mtimeMs: number }
  export function readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number
  export function closeSync(fd: number): void
  export function utimesSync(path: string, atime: number, mtime: number): void
  export function statSync(path: string): { mtimeMs: number; size: number }
}
declare module 'node:os' {
  export function tmpdir(): string
  export function homedir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
  export function isAbsolute(path: string): boolean
  export function dirname(path: string): string
  export function basename(path: string): string
  export function relative(from: string, to: string): string
  export function resolve(...parts: string[]): string
  export function extname(path: string): string
  export const sep: string
}
declare module 'node:url' {
  export function fileURLToPath(url: URL): string
}
declare module 'node:child_process' {
  export function spawn(
    file: string,
    args: string[],
    options: { cwd?: string; detached?: boolean; stdio: ['ignore', number, number] },
  ): { pid: number | undefined; unref(): void; on(event: 'error', listener: () => void): unknown }
  export function execFile(
    file: string,
    args: string[],
    options: { cwd?: string; maxBuffer?: number; timeout?: number; env?: Record<string, string | undefined> },
    callback: (error: { code?: number | string | null; killed?: boolean; message: string } | null, stdout: string, stderr: string) => void,
  ): unknown
}
declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): { update(data: string): { digest(encoding: 'hex'): string } }
}
declare module 'node:net' {
  export function createServer(): {
    once(event: 'error', listener: () => void): unknown
    listen(port: number, host: string, callback: () => void): unknown
    close(callback: () => void): unknown
  }
}
declare const process: { execPath: string; env: Record<string, string | undefined>; kill(pid: number, signal?: 0 | 'SIGTERM' | 'SIGKILL'): true }
