export type TransactionKind = "deploy" | "rollback" | "initialize";
export type TransactionPhase =
  | "publishing"
  | "prepared"
  | "nginx_switched"
  | "hardening_started"
  | "permissions_hardened"
  | "state_committed"
  | "rollback_decided";

type ReleaseState = Readonly<{
  port: 3000 | 3001;
  release: string;
}>;

type OptionalReleaseState = ReleaseState | null;

export type ManagedTopology = Readonly<{
  active: ReleaseState;
  previous: OptionalReleaseState;
}>;

export type TransactionJournal = Readonly<{
  kind: TransactionKind;
  phase: TransactionPhase;
  old: ManagedTopology | null;
  next: ManagedTopology;
}>;

export type RecoveryResult = ManagedTopology &
  Readonly<{
    action:
      | "accept-committed"
      | "complete-post-soak-hardening"
      | "complete-initialization"
      | "discard-uncommitted-publication"
      | "restore-old-topology";
    journalCleared: true;
  }>;

function sameRelease(left: OptionalReleaseState, right: OptionalReleaseState) {
  if (left === null || right === null) return left === right;
  return left.port === right.port && left.release === right.release;
}

function sameTopology(left: ManagedTopology, right: ManagedTopology) {
  return (
    sameRelease(left.active, right.active) &&
    sameRelease(left.previous, right.previous)
  );
}

/**
 * Pure reference model for recover-deployment-state.sh. It intentionally has
 * no filesystem, process-manager, network, or privilege side effects.
 */
export function recoverPowerLoss(
  journal: TransactionJournal,
  durableState: ManagedTopology | null
): RecoveryResult {
  if (journal.kind === "deploy" && journal.phase === "publishing") {
    if (journal.old === null) {
      throw new Error("publishing transaction is missing its old topology");
    }
    return {
      ...journal.old,
      action: "discard-uncommitted-publication",
      journalCleared: true
    };
  }
  if (
    journal.phase === "state_committed" &&
    durableState !== null &&
    sameTopology(durableState, journal.next)
  ) {
    return {
      ...journal.next,
      action: "accept-committed",
      journalCleared: true
    };
  }

  if (
    journal.kind === "deploy" &&
    (journal.phase === "hardening_started" || journal.phase === "permissions_hardened")
  ) {
    return {
      ...journal.next,
      action: "complete-post-soak-hardening",
      journalCleared: true
    };
  }

  if (journal.kind === "initialize") {
    return {
      ...journal.next,
      action: "complete-initialization",
      journalCleared: true
    };
  }

  if (journal.old === null) {
    throw new Error("non-initialization transaction is missing its old topology");
  }

  return {
    ...journal.old,
    action: "restore-old-topology",
    journalCleared: true
  };
}

const releaseA: ReleaseState = {
  port: 3000,
  release: "20260826T010000Z"
};
const releaseB: ReleaseState = {
  port: 3001,
  release: "20260826T020000Z"
};
const releaseC: ReleaseState = {
  port: 3001,
  release: "20260826T000000Z"
};

function journalFor(
  kind: TransactionKind,
  phase: TransactionPhase
): TransactionJournal {
  if (kind === "initialize") {
    return {
      kind,
      phase,
      old: null,
      next: { active: releaseA, previous: null }
    };
  }

  if (kind === "rollback") {
    return {
      kind,
      phase,
      old: { active: releaseB, previous: releaseA },
      next: { active: releaseA, previous: releaseB }
    };
  }

  return {
    kind,
    phase,
    old: { active: releaseA, previous: releaseC },
    next: { active: releaseB, previous: releaseA }
  };
}

const kinds: readonly TransactionKind[] = ["deploy", "rollback", "initialize"];
const basePhases: readonly TransactionPhase[] = [
  "prepared",
  "nginx_switched",
  "state_committed"
];

export const transactionFixtures = kinds.flatMap((kind) => {
  const phases = kind === "deploy"
    ? ([
        "publishing",
        "prepared",
        "nginx_switched",
        "hardening_started",
        "permissions_hardened",
        "state_committed",
        "rollback_decided"
      ] as const)
    : basePhases;
  return phases.map((phase) => {
    const journal = journalFor(kind, phase);
    return {
      kind,
      phase,
      journal,
      observed:
        phase === "state_committed"
          ? journal.next
          : phase === "nginx_switched" || phase === "hardening_started" ||
              phase === "permissions_hardened" || kind === "initialize"
            ? null
            : journal.old
    } as const;
  });
});
