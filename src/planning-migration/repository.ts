import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const maximumSourceBytes = 1_048_576;

type FileFacts = Readonly<{ dev: bigint; ino: bigint }>;
type LeafFacts = FileFacts &
  Readonly<{ size: bigint; mtimeNs: bigint; ctimeNs: bigint }>;

export interface BoundedReadDependencies {
  /** Test-only seam for proving an in-place mutation is rejected before return. */
  readonly afterRead?: () => Promise<void>;
}

export async function findPlanningRepositoryRoot(
  start = process.cwd(),
): Promise<string> {
  let current = await realpath(resolve(start));
  for (;;) {
    try {
      await lstat(resolve(current, "package.json"));
      await lstat(resolve(current, "AGENTS.md"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error("repository");
      current = parent;
    }
  }
}

function isInside(root: string, path: string): boolean {
  const value = relative(root, path);
  return (
    Boolean(value) &&
    value !== ".." &&
    !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}

async function checkedAncestors(
  root: string,
  path: string,
): Promise<FileFacts[]> {
  const segments = relative(root, path).split(
    process.platform === "win32" ? "\\" : "/",
  );
  const facts: FileFacts[] = [];
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = await lstat(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error("file");
    facts.push({ dev: stat.dev, ino: stat.ino });
  }
  return facts;
}

async function ancestorsUnchanged(
  root: string,
  path: string,
  expected: readonly FileFacts[],
): Promise<boolean> {
  const observed = await checkedAncestors(root, path);
  return (
    observed.length === expected.length &&
    observed.every(
      (fact, index) =>
        fact.dev === expected[index]?.dev && fact.ino === expected[index]?.ino,
    )
  );
}

function leafFacts(stat: {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}): LeafFacts {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function sameLeaf(left: LeafFacts, right: LeafFacts): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/** Reads one repository-contained regular file through a no-follow descriptor. */
export async function readBoundedRepositoryFile(
  root: string,
  path: string,
  maximumBytes: number,
  dependencies: BoundedReadDependencies = {},
): Promise<Buffer> {
  const absolute = resolve(path);
  if (
    !isInside(root, absolute) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1
  )
    throw new Error("file");
  const beforeAncestors = await checkedAncestors(root, absolute);
  const beforeStat = await lstat(absolute, { bigint: true });
  const before = leafFacts(beforeStat);
  if (
    !beforeStat.isFile() ||
    beforeStat.isSymbolicLink() ||
    before.size > BigInt(maximumBytes)
  )
    throw new Error("file");
  const handle = await open(
    absolute,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const openedStat = await handle.stat({ bigint: true });
    const opened = leafFacts(openedStat);
    if (
      !openedStat.isFile() ||
      !sameLeaf(opened, before) ||
      !(await ancestorsUnchanged(root, absolute, beforeAncestors))
    )
      throw new Error("file");
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead === 0) throw new Error("file");
      offset += result.bytesRead;
    }
    await dependencies.afterRead?.();
    const afterStat = await handle.stat({ bigint: true });
    const extra = Buffer.alloc(1);
    if (
      !afterStat.isFile() ||
      !sameLeaf(leafFacts(afterStat), opened) ||
      (await handle.read(extra, 0, 1, bytes.length)).bytesRead !== 0 ||
      !(await ancestorsUnchanged(root, absolute, beforeAncestors))
    )
      throw new Error("file");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function sourceDigest(
  root: string,
  sourcePath: string,
): Promise<Readonly<{ bytes: number; sha256: string }>> {
  const bytes = await readBoundedRepositoryFile(
    root,
    resolve(root, sourcePath),
    maximumSourceBytes,
  );
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
